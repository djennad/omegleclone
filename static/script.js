const socket = io({
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5,
    transports: ['websocket', 'polling'],
    upgrade: true,
    rememberUpgrade: true,
    timeout: 60000
});

const userId = Math.random().toString(36).substr(2, 9);
let currentRoom = null;
let localStream = null;
let peerConnection = null;
let isVideoEnabled = false;
let isConnected = false;

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
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
    ]
};

async function setupMediaStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        isVideoEnabled = true;
        toggleVideoButton.textContent = 'Disable Video';
        console.log('Media stream setup successful');
    } catch (error) {
        console.error('Error accessing media devices:', error);
        statusDiv.textContent = 'Failed to access camera/microphone';
    }
}

async function createPeerConnection() {
    try {
        peerConnection = new RTCPeerConnection(configuration);
        console.log('Created peer connection');

        // Add local stream
        if (localStream) {
            localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, localStream);
            });
            console.log('Added local stream to peer connection');
        }

        // Handle incoming stream
        peerConnection.ontrack = event => {
            console.log('Received remote stream');
            remoteVideo.srcObject = event.streams[0];
        };

        // Handle ICE candidates
        peerConnection.onicecandidate = event => {
            if (event.candidate) {
                console.log('Sending ICE candidate');
                socket.emit('ice_candidate', {
                    userId: userId,
                    candidate: event.candidate
                });
            }
        };

        peerConnection.oniceconnectionstatechange = () => {
            console.log('ICE connection state:', peerConnection.iceConnectionState);
        };

        return peerConnection;
    } catch (error) {
        console.error('Error creating peer connection:', error);
        statusDiv.textContent = 'Error setting up video chat';
        return null;
    }
}

async function handleVideoToggle() {
    if (isVideoEnabled) {
        localStream.getTracks().forEach(track => track.stop());
        localVideo.srcObject = null;
        isVideoEnabled = false;
        toggleVideoButton.textContent = 'Enable Video';
        console.log('Video disabled');
    } else {
        await setupMediaStream();
        console.log('Video enabled');
    }
}

function startNewChat() {
    console.log('Starting new chat');
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

// Socket event handlers
socket.on('connect', () => {
    console.log('Connected to server');
    isConnected = true;
    setupMediaStream().then(() => {
        startNewChat();
    });
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    isConnected = false;
    statusDiv.textContent = 'Disconnected from server. Trying to reconnect...';
});

socket.on('connection_established', (data) => {
    console.log('Connection established:', data);
});

socket.on('waiting', () => {
    console.log('Waiting for partner');
    statusDiv.textContent = 'Waiting for someone to join...';
});

socket.on('chat_start', async (data) => {
    console.log('Chat started:', data);
    currentRoom = data.room;
    statusDiv.textContent = 'Connected! Starting video...';
    
    peerConnection = await createPeerConnection();
    
    // Create and send offer if initiator
    if (data.isInitiator && peerConnection) {
        try {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            console.log('Sending video offer');
            socket.emit('video_offer', {
                userId: userId,
                offer: offer
            });
        } catch (error) {
            console.error('Error creating offer:', error);
        }
    }
    
    messageInput.disabled = false;
    sendButton.disabled = false;
});

socket.on('video_offer', async (data) => {
    console.log('Received video offer');
    if (!peerConnection) {
        peerConnection = await createPeerConnection();
    }
    
    if (peerConnection) {
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            
            console.log('Sending video answer');
            socket.emit('video_answer', {
                userId: userId,
                answer: answer
            });
        } catch (error) {
            console.error('Error handling video offer:', error);
        }
    }
});

socket.on('video_answer', async (data) => {
    console.log('Received video answer');
    if (peerConnection) {
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        } catch (error) {
            console.error('Error handling video answer:', error);
        }
    }
});

socket.on('ice_candidate', async (data) => {
    console.log('Received ICE candidate');
    if (peerConnection) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (error) {
            console.error('Error adding ICE candidate:', error);
        }
    }
});

socket.on('message', (data) => {
    console.log('Received message:', data);
    addMessage(data.message, false);
});

socket.on('partner_disconnected', () => {
    console.log('Partner disconnected');
    statusDiv.textContent = 'Partner disconnected. Start a new chat!';
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
        console.log('Sending message:', message);
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
