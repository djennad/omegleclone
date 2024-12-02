from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room, leave_room
import random
import string
import os
import logging
from engineio.async_drivers import gevent

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config['SECRET_KEY'] = ''.join(random.choices(string.ascii_letters + string.digits, k=32))
socketio = SocketIO(app, 
                   async_mode='gevent',
                   cors_allowed_origins="*",
                   logger=True,
                   engineio_logger=True,
                   ping_timeout=60,
                   ping_interval=25,
                   max_http_buffer_size=1e8,
                   manage_session=False)

# Store waiting users and active pairs
waiting_users = []
active_pairs = {}

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('connect')
def handle_connect():
    logger.info(f"Client connected with SID: {request.sid}")
    emit('connection_established', {'status': 'connected'})

@socketio.on('join')
def on_join(data):
    user_id = data['userId']
    logger.info(f"User {user_id} trying to join")
    
    if user_id in waiting_users:
        logger.info(f"User {user_id} already in waiting list")
        return
        
    if user_id in active_pairs:
        logger.info(f"User {user_id} already in active pair")
        return
    
    if len(waiting_users) > 0:
        # Match with a waiting user
        partner_id = waiting_users.pop(0)
        room = f"{min(user_id, partner_id)}-{max(user_id, partner_id)}"
        logger.info(f"Matching users {user_id} and {partner_id} in room {room}")
        
        # Add both users to the room
        join_room(room)
        active_pairs[user_id] = {'partner': partner_id, 'room': room}
        active_pairs[partner_id] = {'partner': user_id, 'room': room}
        
        # Notify both users that they're connected
        emit('chat_start', {'room': room, 'isInitiator': True}, to=user_id)
        emit('chat_start', {'room': room, 'isInitiator': False}, to=partner_id)
        logger.info(f"Room {room} established")
    else:
        # Add user to waiting list
        waiting_users.append(user_id)
        emit('waiting')
        logger.info(f"User {user_id} added to waiting list")

@socketio.on('message')
def handle_message(data):
    user_id = data['userId']
    message = data['message']
    logger.info(f"Message from {user_id}: {message}")
    
    if user_id in active_pairs:
        room = active_pairs[user_id]['room']
        emit('message', {'message': message}, room=room)

@socketio.on('video_offer')
def handle_video_offer(data):
    user_id = data['userId']
    if user_id in active_pairs:
        partner_id = active_pairs[user_id]['partner']
        logger.info(f"Video offer from {user_id} to {partner_id}")
        emit('video_offer', {'offer': data['offer']}, to=partner_id)

@socketio.on('video_answer')
def handle_video_answer(data):
    user_id = data['userId']
    if user_id in active_pairs:
        partner_id = active_pairs[user_id]['partner']
        logger.info(f"Video answer from {user_id} to {partner_id}")
        emit('video_answer', {'answer': data['answer']}, to=partner_id)

@socketio.on('ice_candidate')
def handle_ice_candidate(data):
    user_id = data['userId']
    if user_id in active_pairs:
        partner_id = active_pairs[user_id]['partner']
        logger.info(f"ICE candidate from {user_id} to {partner_id}")
        emit('ice_candidate', {'candidate': data['candidate']}, to=partner_id)

@socketio.on('disconnect')
def handle_disconnect():
    logger.info(f"Client disconnected: {request.sid}")
    for user_id, pair_data in list(active_pairs.items()):
        partner_id = pair_data['partner']
        room = pair_data['room']
        
        # Clean up the room and notify the partner
        if room:
            leave_room(room)
            emit('partner_disconnected', room=room)
            logger.info(f"Room {room} cleaned up")
            
            # Clean up the pairs
            if user_id in active_pairs:
                del active_pairs[user_id]
            if partner_id in active_pairs:
                del active_pairs[partner_id]

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    logger.info(f"Starting server on port {port}")
    socketio.run(app, host='0.0.0.0', port=port, log_output=True)
