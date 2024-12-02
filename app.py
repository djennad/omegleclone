from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room, leave_room, disconnect
import random
import string
import os
import logging
from datetime import datetime
from engineio.payload import Payload

# Increase max payload size
Payload.max_decode_packets = 50

# Set up logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config['SECRET_KEY'] = ''.join(random.choices(string.ascii_letters + string.digits, k=32))
app.config['DEBUG'] = True

socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode='gevent',
    logger=True,
    engineio_logger=True,
    ping_timeout=60000,
    ping_interval=25000,
    max_http_buffer_size=1000000,
    allow_upgrades=True,
    transports=['polling', 'websocket']
)

# Store waiting users and active pairs with timestamps
waiting_users = {}  # {user_id: timestamp}
active_pairs = {}   # {room: {user1: id1, user2: id2}}
user_rooms = {}     # {user_id: room}
user_sids = {}      # {user_id: session_id}

def clean_inactive_users():
    """Remove users who have been waiting too long (more than 5 minutes)"""
    current_time = datetime.now().timestamp()
    inactive_users = [uid for uid, timestamp in waiting_users.items() 
                     if current_time - timestamp > 300]
    for uid in inactive_users:
        del waiting_users[uid]
        if uid in user_sids:
            del user_sids[uid]
    return len(inactive_users)

def find_partner(user_id):
    """Find a partner for the user"""
    clean_inactive_users()
    available_users = [uid for uid in waiting_users.keys() if uid != user_id]
    if available_users:
        partner_id = random.choice(available_users)
        room = f"room_{random.randint(1000, 9999)}"
        
        # Remove both users from waiting list
        del waiting_users[partner_id]
        if user_id in waiting_users:
            del waiting_users[user_id]
        
        # Add to active pairs
        active_pairs[room] = {"user1": user_id, "user2": partner_id}
        user_rooms[user_id] = room
        user_rooms[partner_id] = room
        
        logger.info(f"Matched users {user_id} and {partner_id} in room {room}")
        return room, partner_id
    return None, None

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/favicon.ico')
def favicon():
    return '', 204

@socketio.on('connect')
def handle_connect():
    sid = request.sid
    logger.info(f'Client connected with session ID: {sid}')
    emit('connected', {'status': 'connected', 'sid': sid})

@socketio.on('disconnect')
def handle_disconnect():
    sid = request.sid
    user_id = None
    
    # Find user_id by session id
    for uid, stored_sid in user_sids.items():
        if stored_sid == sid:
            user_id = uid
            break
    
    if user_id:
        logger.info(f'User {user_id} disconnected')
        handle_leave({'userId': user_id})
        if user_id in user_sids:
            del user_sids[user_id]

@socketio.on('join')
def handle_join(data):
    user_id = data['userId']
    sid = request.sid
    logger.info(f'User {user_id} joining with session {sid}')
    
    # Store user's session id
    user_sids[user_id] = sid
    
    # Add user to waiting list with timestamp
    waiting_users[user_id] = datetime.now().timestamp()
    emit('waiting')
    
    # Try to find a partner
    room, partner_id = find_partner(user_id)
    if room and partner_id:
        # Join both users to the room
        join_room(room)
        emit('chat_start', {'room': room}, room=room)
        logger.info(f'Matched users {user_id} and {partner_id} in room {room}')

@socketio.on('leave')
def handle_leave(data):
    user_id = data['userId']
    logger.info(f'User {user_id} leaving')
    
    # Remove from waiting list if present
    if user_id in waiting_users:
        del waiting_users[user_id]
    
    # Handle active chat disconnection
    if user_id in user_rooms:
        room = user_rooms[user_id]
        if room in active_pairs:
            # Notify other user
            pair = active_pairs[room]
            other_user = pair['user2'] if user_id == pair['user1'] else pair['user1']
            
            if other_user in user_sids:
                emit('partner_disconnected', room=room)
            
            # Clean up
            del active_pairs[room]
            if user_id in user_rooms:
                del user_rooms[user_id]
            if other_user in user_rooms:
                del user_rooms[other_user]
            
            leave_room(room)
            logger.info(f'Room {room} closed due to user {user_id} leaving')

@socketio.on('message')
def handle_message(data):
    room = data.get('room')
    if room and room in active_pairs:
        emit('message', {
            'userId': data['userId'],
            'message': data['message']
        }, room=room)

@socketio.on('video_offer')
def handle_video_offer(data):
    user_id = data['userId']
    if user_id in user_rooms:
        room = user_rooms[user_id]
        if room in active_pairs:
            pair = active_pairs[room]
            other_user = pair['user2'] if user_id == pair['user1'] else pair['user1']
            if other_user in user_sids:
                emit('video_offer', {'offer': data['offer']}, room=room)

@socketio.on('video_answer')
def handle_video_answer(data):
    user_id = data['userId']
    if user_id in user_rooms:
        room = user_rooms[user_id]
        if room in active_pairs:
            pair = active_pairs[room]
            other_user = pair['user2'] if user_id == pair['user1'] else pair['user1']
            if other_user in user_sids:
                emit('video_answer', {'answer': data['answer']}, room=room)

@socketio.on('ice_candidate')
def handle_ice_candidate(data):
    user_id = data['userId']
    if user_id in user_rooms:
        room = user_rooms[user_id]
        if room in active_pairs:
            pair = active_pairs[room]
            other_user = pair['user2'] if user_id == pair['user1'] else pair['user1']
            if other_user in user_sids:
                emit('ice_candidate', {'candidate': data['candidate']}, room=room)

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    socketio.run(app, 
                host='0.0.0.0', 
                port=port,
                debug=True,
                use_reloader=False,
                log_output=True)
