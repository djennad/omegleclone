from flask import Flask, render_template
from flask_socketio import SocketIO, emit, join_room, leave_room
import random
import string
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = ''.join(random.choices(string.ascii_letters + string.digits, k=32))
socketio = SocketIO(app, 
                   cors_allowed_origins="*",
                   async_mode='gevent',
                   ping_timeout=60,
                   ping_interval=25,
                   logger=True,
                   engineio_logger=True)

# Store waiting users and active pairs
waiting_users = []
active_pairs = {}

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/favicon.ico')
def favicon():
    return '', 204

@socketio.on('connect')
def handle_connect():
    print('Client connected')
    emit('connected')

@socketio.on('join')
def on_join(data):
    user_id = data['userId']
    
    if len(waiting_users) > 0:
        # Match with a waiting user
        partner_id = waiting_users.pop(0)
        room = f"{min(user_id, partner_id)}-{max(user_id, partner_id)}"
        
        # Add both users to the room
        join_room(room)
        active_pairs[user_id] = {'partner': partner_id, 'room': room}
        active_pairs[partner_id] = {'partner': user_id, 'room': room}
        
        # Notify both users that they're connected
        emit('chat_start', {'room': room, 'isInitiator': True}, to=user_id)
        emit('chat_start', {'room': room, 'isInitiator': False}, to=partner_id)
    else:
        # Add user to waiting list
        waiting_users.append(user_id)
        emit('waiting')

@socketio.on('message')
def handle_message(data):
    user_id = data['userId']
    message = data['message']
    
    if user_id in active_pairs:
        room = active_pairs[user_id]['room']
        emit('message', {'message': message}, room=room)

@socketio.on('video_offer')
def handle_video_offer(data):
    user_id = data['userId']
    if user_id in active_pairs:
        partner_id = active_pairs[user_id]['partner']
        emit('video_offer', {'offer': data['offer']}, to=partner_id)

@socketio.on('video_answer')
def handle_video_answer(data):
    user_id = data['userId']
    if user_id in active_pairs:
        partner_id = active_pairs[user_id]['partner']
        emit('video_answer', {'answer': data['answer']}, to=partner_id)

@socketio.on('ice_candidate')
def handle_ice_candidate(data):
    user_id = data['userId']
    if user_id in active_pairs:
        partner_id = active_pairs[user_id]['partner']
        emit('ice_candidate', {'candidate': data['candidate']}, to=partner_id)

@socketio.on('disconnect')
def handle_disconnect():
    for user_id, pair_data in list(active_pairs.items()):
        partner_id = pair_data['partner']
        room = pair_data['room']
        
        # Clean up the room and notify the partner
        if room:
            leave_room(room)
            emit('partner_disconnected', room=room)
            
            # Clean up the pairs
            if user_id in active_pairs:
                del active_pairs[user_id]
            if partner_id in active_pairs:
                del active_pairs[partner_id]

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    socketio.run(app, host='0.0.0.0', port=port)
