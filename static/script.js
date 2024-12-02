const socket = io({
    transports: ['polling', 'websocket'],
    upgrade: true,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    timeout: 60000,
    autoConnect: true,
    forceNew: true
});

const userId = Math.random().toString(36).substr(2, 9);
let currentRoom = null;
let localStream = null;
let peerConnection = null;
let isVideoEnabled = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const chatBox = document.getElementById('chat-box');
const statusDiv = document.getElementById('status');
const newChatButton = document.getElementById('new-chat');
const toggleVideoButton = document.getElementById('toggle-video');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');

function updateStatus(message) {
    console.log(message);
    statusDiv.textContent = message;
}

async function setupMediaStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
        });
        localVideo.srcObject = localStream;
        isVideoEnabled = true;
        toggleVideoButton.textContent = 'Disable Video';
        return true;
    } catch (error) {
        console.error('Error accessing media devices:', error);
        updateStatus('Could not access camera/microphone');
        return false;
    }
}

function startNewChat() {
    if (currentRoom) {
        socket.emit('leave', { userId });
    }
    
    // Reset UI
    chatBox.innerHTML = '';
    messageInput.value = '';
    messageInput.disabled = true;
    sendButton.disabled = true;
    remoteVideo.srcObject = null;
    
    // Join new chat
    updateStatus('Looking for a partner...');
    socket.emit('join', { userId });
}

// Socket event handlers
socket.on('connect', () => {
    updateStatus('Connected to server');
    reconnectAttempts = 0;
    setupMediaStream().then(() => {
        startNewChat();
    }).catch(error => {
        console.error('Media stream error:', error);
        updateStatus('Failed to access camera/microphone');
    });
});

socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    updateStatus('Connection error. Retrying...');
    reconnectAttempts++;
    
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        updateStatus('Failed to connect after multiple attempts. Please refresh the page.');
        socket.disconnect();
    }
});

socket.on('disconnect', () => {
    updateStatus('Disconnected from server. Reconnecting...');
    if (currentRoom) {
        socket.emit('leave', { userId });
        currentRoom = null;
    }
});

socket.on('connected', (data) => {
    console.log('Server acknowledged connection:', data);
    updateStatus('Connected and ready');
});

socket.on('waiting', () => {
    updateStatus('Waiting for someone to join...');
});

socket.on('chat_start', async (data) => {
    currentRoom = data.room;
    messageInput.disabled = false;
    sendButton.disabled = false;
    updateStatus('Connected! Starting video...');
    
    try {
        peerConnection = await createPeerConnection();
        // Add local stream
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
        
        // Create and send offer
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('video_offer', {
            userId,
            offer: offer
        });
    } catch (error) {
        console.error('Error setting up WebRTC:', error);
        updateStatus('Failed to setup video chat');
    }
});

socket.on('video_offer', async (data) => {
    try {
        peerConnection = await createPeerConnection();
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        
        // Add local stream
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
        
        // Create and send answer
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('video_answer', {
            userId,
            answer: answer
        });
    } catch (error) {
        console.error('Error handling video offer:', error);
    }
});

socket.on('video_answer', async (data) => {
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    } catch (error) {
        console.error('Error handling video answer:', error);
    }
});

socket.on('ice_candidate', async (data) => {
    try {
        if (data.candidate) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    } catch (error) {
        console.error('Error handling ICE candidate:', error);
    }
});

socket.on('partner_disconnected', () => {
    updateStatus('Partner disconnected. Start a new chat!');
    messageInput.disabled = true;
    sendButton.disabled = true;
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    remoteVideo.srcObject = null;
    currentRoom = null;
});

// UI Event Listeners
newChatButton.addEventListener('click', startNewChat);

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

sendButton.addEventListener('click', sendMessage);

toggleVideoButton.addEventListener('click', () => {
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            isVideoEnabled = !isVideoEnabled;
            videoTrack.enabled = isVideoEnabled;
            toggleVideoButton.textContent = isVideoEnabled ? 'Disable Video' : 'Enable Video';
        }
    }
});

function sendMessage() {
    const message = messageInput.value.trim();
    if (message && currentRoom) {
        socket.emit('message', {
            userId,
            room: currentRoom,
            message
        });
        
        // Add message to chat box
        const messageElement = document.createElement('div');
        messageElement.className = 'message sent';
        messageElement.textContent = `You: ${message}`;
        chatBox.appendChild(messageElement);
        chatBox.scrollTop = chatBox.scrollHeight;
        
        messageInput.value = '';
    }
}

async function createPeerConnection() {
    const configuration = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' }
        ]
    };

    const pc = new RTCPeerConnection(configuration);
    
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice_candidate', {
                userId,
                candidate: event.candidate
            });
        }
    };
    
    pc.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
            remoteVideo.srcObject = event.streams[0];
        }
    };
    
    pc.oniceconnectionstatechange = () => {
        console.log('ICE Connection State:', pc.iceConnectionState);
        if (pc.iceConnectionState === 'disconnected') {
            updateStatus('Video connection lost. Try starting a new chat.');
        }
    };
    
    return pc;
}
