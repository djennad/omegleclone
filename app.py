from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room, leave_room, disconnect
import random
import string
import os
import logging
from datetime import datetime
from engineio.payload import Payload
from gevent import monkey
monkey.patch_all()

# Increase max payload size
Payload.max_decode_packets = 50

# Set up logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config['SECRET_KEY'] = ''.join(random.choices(string.ascii_letters + string.digits, k=32))
app.config['DEBUG'] = True
app.config['PROPAGATE_EXCEPTIONS'] = True

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
    transports=['polling', 'websocket'],
    always_connect=True,
    manage_session=True
)

# Store waiting users and active pairs with timestamps
waiting_users = {}  # {user_id: timestamp}
active_pairs = {}   # {room: {user1: id1, user2: id2}}
user_rooms = {}     # {user_id: room}
user_sids = {}      # {user_id: session_id}

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/favicon.ico')
def favicon():
    return '', 204

@socketio.on('connect')
def handle_connect():
    sid = request.sid
    logger.info(f'Client connected with SID: {sid}')
    emit('connected', {'status': 'connected', 'sid': sid})

@socketio.on('disconnect')
def handle_disconnect():
    sid = request.sid
    logger.info(f'Client disconnected with SID: {sid}')
    for user_id, user_sid in user_sids.items():
        if user_sid == sid:
            handle_leave({'userId': user_id})
            break

@socketio.on('join')
def handle_join(data):
    user_id = data.get('userId')
    if not user_id:
        return
    
    # Store user's session ID
    user_sids[user_id] = request.sid
    
    # Remove user from any existing room
    if user_id in user_rooms:
        old_room = user_rooms[user_id]
        if old_room in active_pairs:
            del active_pairs[old_room]
        del user_rooms[user_id]
    
    # If someone is waiting, pair them
    if waiting_users:
        partner_id = next(iter(waiting_users))
        if partner_id != user_id:  # Don't pair with self
            del waiting_users[partner_id]
            
            # Create new room
            room = f"room_{random.randint(1000, 9999)}"
            active_pairs[room] = {'user1': partner_id, 'user2': user_id}
            user_rooms[partner_id] = room
            user_rooms[user_id] = room
            
            # Join both users to room
            join_room(room)
            partner_sid = user_sids.get(partner_id)
            if partner_sid:
                join_room(room, sid=partner_sid)
            
            # Notify both users
            emit('chat_start', {'room': room}, room=room)
            return
    
    # If no partner found, add to waiting list
    waiting_users[user_id] = datetime.now()
    emit('waiting')

@socketio.on('leave')
def handle_leave(data):
    user_id = data.get('userId')
    if not user_id:
        return
    
    # Remove from waiting list if present
    if user_id in waiting_users:
        del waiting_users[user_id]
    
    # Handle active chat disconnection
    if user_id in user_rooms:
        room = user_rooms[user_id]
        if room in active_pairs:
            # Find and notify partner
            pair = active_pairs[room]
            partner_id = pair['user1'] if user_id == pair['user2'] else pair['user2']
            if partner_id in user_sids:
                emit('partner_disconnected', room=user_sids[partner_id])
            
            # Cleanup room
            del active_pairs[room]
            if partner_id in user_rooms:
                del user_rooms[partner_id]
        
        # Leave room and cleanup
        leave_room(room)
        del user_rooms[user_id]
    
    # Cleanup session
    if user_id in user_sids:
        del user_sids[user_id]

@socketio.on('message')
def handle_message(data):
    user_id = data.get('userId')
    room = data.get('room')
    message = data.get('message')
    
    if user_id and room and message and room in active_pairs:
        emit('message', {
            'userId': user_id,
            'message': message
        }, room=room, include_self=False)

@socketio.on('video_offer')
def handle_video_offer(data):
    user_id = data.get('userId')
    offer = data.get('offer')
    
    if user_id in user_rooms:
        room = user_rooms[user_id]
        if room in active_pairs:
            emit('video_offer', {
                'userId': user_id,
                'offer': offer
            }, room=room, include_self=False)

@socketio.on('video_answer')
def handle_video_answer(data):
    user_id = data.get('userId')
    answer = data.get('answer')
    
    if user_id in user_rooms:
        room = user_rooms[user_id]
        if room in active_pairs:
            emit('video_answer', {
                'userId': user_id,
                'answer': answer
            }, room=room, include_self=False)

@socketio.on('ice_candidate')
def handle_ice_candidate(data):
    user_id = data.get('userId')
    candidate = data.get('candidate')
    
    if user_id in user_rooms:
        room = user_rooms[user_id]
        if room in active_pairs:
            emit('ice_candidate', {
                'userId': user_id,
                'candidate': candidate
            }, room=room, include_self=False)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    socketio.run(app, host='0.0.0.0', port=port)
