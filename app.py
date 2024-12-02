from flask import Flask, render_template, request, session
from flask_socketio import SocketIO, emit, join_room, leave_room, disconnect
import random
import string
import os
import logging
from datetime import datetime
from engineio.payload import Payload
from gevent import monkey
monkey.patch_all()

# Increase max payload size and configure logging
Payload.max_decode_packets = 50
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
    transports=['polling', 'websocket']
)

# Store user states
waiting_users = set()  # Set of waiting user IDs
active_pairs = {}      # {room: {user1: id1, user2: id2}}
user_rooms = {}        # {user_id: room}
user_sids = {}         # {user_id: sid}

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('connect')
def handle_connect():
    sid = request.sid
    logger.info(f'Client connected with SID: {sid}')
    emit('connected', {'status': 'connected', 'sid': sid})

@socketio.on('disconnect')
def handle_disconnect():
    sid = request.sid
    logger.info(f'Client disconnected with SID: {sid}')
    
    # Find user by SID and handle cleanup
    disconnected_user = None
    for user_id, user_sid in user_sids.items():
        if user_sid == sid:
            disconnected_user = user_id
            break
    
    if disconnected_user:
        handle_leave({'userId': disconnected_user})

def find_available_partner(user_id):
    """Find an available partner for chat"""
    if not waiting_users:
        return None
    
    # Find a partner that isn't the same user
    for partner_id in waiting_users:
        if partner_id != user_id:
            waiting_users.remove(partner_id)
            return partner_id
    return None

@socketio.on('join')
def handle_join(data):
    try:
        user_id = data.get('userId')
        if not user_id:
            logger.error('No user ID provided')
            return
        
        logger.info(f'User {user_id} joining')
        
        # Store user's session ID
        user_sids[user_id] = request.sid
        
        # Remove from any existing room
        if user_id in user_rooms:
            old_room = user_rooms[user_id]
            if old_room in active_pairs:
                # Notify old partner
                pair = active_pairs[old_room]
                old_partner = pair['user1'] if user_id == pair['user2'] else pair['user2']
                if old_partner in user_sids:
                    emit('partner_disconnected', room=user_sids[old_partner])
                
                del active_pairs[old_room]
                if old_partner in user_rooms:
                    del user_rooms[old_partner]
            
            leave_room(old_room)
            del user_rooms[user_id]
        
        # Try to find a partner
        partner_id = find_available_partner(user_id)
        
        if partner_id:
            # Create new room
            room = f"room_{random.randint(1000, 9999)}"
            
            # Set up room
            active_pairs[room] = {'user1': partner_id, 'user2': user_id}
            user_rooms[partner_id] = room
            user_rooms[user_id] = room
            
            # Join room
            join_room(room)
            if partner_id in user_sids:
                join_room(room, sid=user_sids[partner_id])
            
            logger.info(f'Matched users {user_id} and {partner_id} in room {room}')
            emit('chat_start', {'room': room}, room=room)
        else:
            # Add to waiting list
            waiting_users.add(user_id)
            emit('waiting')
            logger.info(f'User {user_id} added to waiting list')
    
    except Exception as e:
        logger.error(f'Error in handle_join: {str(e)}')
        emit('error', {'message': 'Failed to join chat'})

@socketio.on('leave')
def handle_leave(data):
    try:
        user_id = data.get('userId')
        if not user_id:
            return
        
        logger.info(f'User {user_id} leaving')
        
        # Remove from waiting list
        if user_id in waiting_users:
            waiting_users.remove(user_id)
        
        # Handle active chat cleanup
        if user_id in user_rooms:
            room = user_rooms[user_id]
            if room in active_pairs:
                pair = active_pairs[room]
                partner_id = pair['user1'] if user_id == pair['user2'] else pair['user2']
                
                # Notify partner
                if partner_id in user_sids:
                    emit('partner_disconnected', room=user_sids[partner_id])
                
                # Cleanup room
                del active_pairs[room]
                if partner_id in user_rooms:
                    del user_rooms[partner_id]
            
            leave_room(room)
            del user_rooms[user_id]
        
        # Cleanup session
        if user_id in user_sids:
            del user_sids[user_id]
        
    except Exception as e:
        logger.error(f'Error in handle_leave: {str(e)}')

@socketio.on('message')
def handle_message(data):
    try:
        user_id = data.get('userId')
        room = data.get('room')
        message = data.get('message')
        
        if user_id and room and message and room in active_pairs:
            emit('message', {
                'userId': user_id,
                'message': message
            }, room=room, include_self=False)
    
    except Exception as e:
        logger.error(f'Error in handle_message: {str(e)}')

@socketio.on('video_offer')
def handle_video_offer(data):
    try:
        user_id = data.get('userId')
        offer = data.get('offer')
        
        if user_id in user_rooms:
            room = user_rooms[user_id]
            if room in active_pairs:
                emit('video_offer', {
                    'userId': user_id,
                    'offer': offer
                }, room=room, include_self=False)
    
    except Exception as e:
        logger.error(f'Error in handle_video_offer: {str(e)}')

@socketio.on('video_answer')
def handle_video_answer(data):
    try:
        user_id = data.get('userId')
        answer = data.get('answer')
        
        if user_id in user_rooms:
            room = user_rooms[user_id]
            if room in active_pairs:
                emit('video_answer', {
                    'userId': user_id,
                    'answer': answer
                }, room=room, include_self=False)
    
    except Exception as e:
        logger.error(f'Error in handle_video_answer: {str(e)}')

@socketio.on('ice_candidate')
def handle_ice_candidate(data):
    try:
        user_id = data.get('userId')
        candidate = data.get('candidate')
        
        if user_id in user_rooms:
            room = user_rooms[user_id]
            if room in active_pairs:
                emit('ice_candidate', {
                    'userId': user_id,
                    'candidate': candidate
                }, room=room, include_self=False)
    
    except Exception as e:
        logger.error(f'Error in handle_ice_candidate: {str(e)}')

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    socketio.run(app, host='0.0.0.0', port=port)
