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

const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};

async function setupMediaStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        isVideoEnabled = true;
        toggleVideoButton.textContent = 'Disable Video';
    } catch (error) {
        console.error('Error accessing media devices:', error);
        statusDiv.textContent = 'Failed to access camera/microphone';
    }
}

async function createPeerConnection() {
    peerConnection = new RTCPeerConnection(configuration);

    // Add local stream
    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }

    // Handle incoming stream
    peerConnection.ontrack = event => {
        remoteVideo.srcObject = event.streams[0];
    };

    // Handle ICE candidates
    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            socket.emit('ice_candidate', {
                userId: userId,
                candidate: event.candidate
            });
        }
    };

    return peerConnection;
}

async function handleVideoToggle() {
    if (isVideoEnabled) {
        localStream.getTracks().forEach(track => track.stop());
        localVideo.srcObject = null;
        isVideoEnabled = false;
        toggleVideoButton.textContent = 'Enable Video';
    } else {
        await setupMediaStream();
    }
}

async function startNewChat() {
    // Clean up previous connection
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    // Clear chat box and disable inputs
    chatBox.innerHTML = '';
    messageInput.value = '';
    messageInput.disabled = true;
    sendButton.disabled = true;
    statusDiv.textContent = 'Looking for a partner...';
    statusDiv.style.display = 'block';
    remoteVideo.srcObject = null;
    
    // Join the chat queue
    socket.emit('join', { userId: userId });
}

function updateStatus(message) {
    console.log(message);
    statusDiv.textContent = message;
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
    updateStatus('Connected! Starting video...');
    
    peerConnection = await createPeerConnection();
    
    // Create and send offer if initiator
    if (data.isInitiator) {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('video_offer', {
            userId: userId,
            offer: offer
        });
    }
    
    messageInput.disabled = false;
    sendButton.disabled = false;
});

socket.on('video_offer', async (data) => {
    if (!peerConnection) {
        peerConnection = await createPeerConnection();
    }
    
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    
    socket.emit('video_answer', {
        userId: userId,
        answer: answer
    });
});

socket.on('video_answer', async (data) => {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
});

socket.on('ice_candidate', async (data) => {
    if (peerConnection) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
});

socket.on('message', (data) => {
    addMessage(data.message, false);
});

socket.on('partner_disconnected', () => {
    updateStatus('Partner disconnected. Start a new chat!');
    messageInput.disabled = true;
    sendButton.disabled = true;
    currentRoom = null;
    remoteVideo.srcObject = null;
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
});

function addMessage(message, isSent) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message');
    messageDiv.classList.add(isSent ? 'sent' : 'received');
    messageDiv.textContent = message;
    chatBox.appendChild(messageDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
}

// Event listeners
sendButton.addEventListener('click', () => {
    const message = messageInput.value.trim();
    if (message && currentRoom) {
        socket.emit('message', { userId: userId, message: message });
        addMessage(message, true);
        messageInput.value = '';
    }
});

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendButton.click();
    }
});

toggleVideoButton.addEventListener('click', handleVideoToggle);
newChatButton.addEventListener('click', startNewChat);
