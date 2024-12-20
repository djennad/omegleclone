const socket = io({
    transports: ['websocket', 'polling'],
    upgrade: true,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    timeout: 60000,
    forceNew: false,
    path: '/socket.io',
    rememberUpgrade: true,
    pingInterval: 25000,
    pingTimeout: 60000,
    autoConnect: true
});

const userId = Math.random().toString(36).substr(2, 9);
let currentRoom = null;
let localStream = null;
let peerConnection = null;
let isVideoEnabled = false;
let reconnectAttempts = 0;
let isInitiator = false;
let localTracks = new Set();
let isConnecting = false;
const MAX_RECONNECT_ATTEMPTS = 5;
const RETRY_DELAY = 2000;

// Add connection state tracking
let connectionAttempts = 0;
const MAX_CONNECTION_ATTEMPTS = 3;
const CONNECTION_RETRY_DELAY = 5000;

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
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }
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
    if (isConnecting) {
        return;
    }
    
    cleanupPeerConnection();
    
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

function cleanupPeerConnection() {
    localTracks.clear();
    if (peerConnection) {
        peerConnection.onicecandidate = null;
        peerConnection.ontrack = null;
        peerConnection.oniceconnectionstatechange = null;
        
        // Close all transceivers
        if (peerConnection.getTransceivers) {
            peerConnection.getTransceivers().forEach(transceiver => {
                if (transceiver.stop) {
                    transceiver.stop();
                }
            });
        }
        
        peerConnection.close();
        peerConnection = null;
    }
    if (currentRoom) {
        socket.emit('leave', { userId });
        currentRoom = null;
    }
}

async function addLocalTracks(pc) {
    if (!localStream) return;
    
    try {
        const tracks = localStream.getTracks();
        for (const track of tracks) {
            if (!localTracks.has(track.id)) {
                const sender = pc.addTrack(track, localStream);
                localTracks.add(track.id);
            }
        }
    } catch (error) {
        console.error('Error adding local tracks:', error);
    }
}

// Socket event handlers
socket.on('connect', () => {
    console.log('Connected to server');
    connectionAttempts = 0;
    updateStatus('Connected to server');
    
    setupMediaStream().then(() => {
        startNewChat();
    }).catch(error => {
        console.error('Media stream error:', error);
        updateStatus('Failed to access camera/microphone');
    });
});

socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    connectionAttempts++;
    
    if (connectionAttempts < MAX_CONNECTION_ATTEMPTS) {
        updateStatus(`Connection error. Retrying (${connectionAttempts}/${MAX_CONNECTION_ATTEMPTS})...`);
        setTimeout(() => {
            socket.connect();
        }, CONNECTION_RETRY_DELAY);
    } else {
        updateStatus('Failed to establish connection. Please refresh the page.');
        socket.disconnect();
    }
});

socket.on('disconnect', (reason) => {
    console.log('Disconnected:', reason);
    updateStatus('Disconnected from server. Attempting to reconnect...');
    cleanupPeerConnection();
    
    if (reason === 'io server disconnect') {
        // Server disconnected us, retry connection
        setTimeout(() => {
            socket.connect();
        }, CONNECTION_RETRY_DELAY);
    }
});

socket.on('error', (data) => {
    console.error('Server error:', data);
    updateStatus(data.message || 'An error occurred');
    if (currentRoom) {
        startNewChat();
    }
});

socket.on('waiting', () => {
    updateStatus('Waiting for someone to join...');
});

socket.on('chat_start', async (data) => {
    if (!data || !data.room) {
        console.error('Invalid chat_start data');
        return;
    }
    
    currentRoom = data.room;
    messageInput.disabled = false;
    sendButton.disabled = false;
    updateStatus('Connected! Starting video...');
    
    try {
        cleanupPeerConnection();
        peerConnection = await createPeerConnection();
        await addLocalTracks(peerConnection);
        
        if (isInitiator) {
            const offer = await peerConnection.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true
            });
            await peerConnection.setLocalDescription(offer);
            socket.emit('video_offer', {
                userId,
                offer: offer
            });
        }
    } catch (error) {
        console.error('Error setting up WebRTC:', error);
        updateStatus('Failed to setup video chat');
        startNewChat();
    }
});

socket.on('video_offer', async (data) => {
    try {
        cleanupPeerConnection();
        peerConnection = await createPeerConnection();
        
        const offerDesc = new RTCSessionDescription(data.offer);
        await peerConnection.setRemoteDescription(offerDesc);
        await addLocalTracks(peerConnection);
        
        // Create and send answer
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('video_answer', {
            userId,
            answer: answer
        });
    } catch (error) {
        console.error('Error handling video offer:', error);
        updateStatus('Failed to establish video connection');
    }
});

socket.on('video_answer', async (data) => {
    try {
        if (!peerConnection) {
            console.error('No peer connection when receiving answer');
            return;
        }
        
        const answerDesc = new RTCSessionDescription(data.answer);
        if (peerConnection.signalingState === "have-local-offer") {
            await peerConnection.setRemoteDescription(answerDesc);
        } else {
            console.warn('Unexpected signaling state:', peerConnection.signalingState);
        }
    } catch (error) {
        console.error('Error handling video answer:', error);
    }
});

socket.on('ice_candidate', async (data) => {
    try {
        if (peerConnection && data.candidate && peerConnection.remoteDescription) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    } catch (error) {
        console.error('Error handling ICE candidate:', error);
    }
});

socket.on('partner_disconnected', () => {
    updateStatus('Partner disconnected. Start a new chat!');
    cleanupPeerConnection();
});

// UI Event Listeners
newChatButton.addEventListener('click', () => {
    if (!isConnecting) {
        startNewChat();
    }
});

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

sendButton.addEventListener('click', sendMessage);

toggleVideoButton.addEventListener('click', async () => {
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
        if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
            updateStatus('Video connection lost. Try starting a new chat.');
            cleanupPeerConnection();
        }
    };
    
    return pc;
}
