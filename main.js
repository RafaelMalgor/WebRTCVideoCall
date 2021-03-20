import './style.css';

import firebase from 'firebase/app';
import 'firebase/firestore';

const firebaseConfig = {
    apiKey: "AIzaSyDhMFVUourvyLmRsVUEA7yNi3klUXE0wp8",
    authDomain: "webrtcvideocall-cf42b.firebaseapp.com",
    projectId: "webrtcvideocall-cf42b",
    storageBucket: "webrtcvideocall-cf42b.appspot.com",
    messagingSenderId: "621771754753",
    appId: "1:621771754753:web:8f2bfd9e1e25dfec905f00",
    measurementId: "G-DVEV03TV3T"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const firestore = firebase.firestore();

const servers = {
    iceServers: [
        {
            urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
        },
    ],
    iceCandidatePoolSize: 10,
};

// Global State
let pc = null;
let localStream = null;
let remoteStream = null;

// HTML elements
const webcamButton = document.getElementById('webcamButton');
const webcamVideo = document.getElementById('webcamVideo');
const callInput = document.getElementById('callinput');
const answerInput = document.getElementById('answerInput');
const answerButton = document.getElementById('answerButton');
const remoteVideo = document.getElementById('remoteVideo');
const content = document.getElementById('video-content');
const hangButton = document.getElementById('hangbutton');
const actions = document.getElementById('actions');
const copyButton = document.getElementById('copybutton');
const invalididSpan = document.getElementById('invalid-id');

// We save the starting state to avoid conflicts with CSS
let actionsDisplay = actions.style.display;
let contentDisplay = content.style.display;
let invalididDisplay = invalididSpan.style.display;

let allowAnswer = false;
content.style.display = "none";
invalididSpan.style.display = "none";

copyButton.onclick = () => {
    callInput.select();
    callInput.setSelectionRange(0, 99999);
    document.execCommand("copy");
};

webcamButton.onclick = async () => {
    content.style.display = contentDisplay;
    actions.style.display = "none";

    await startStreams();

    webcamButton.textContent = "Stop Video Call";

    await createCall();
};

hangButton.onclick = () => {
    endCall();
};


answerInput.onchange = () => {
    allowAnswer = answerInput.value.length > 0;
    invalididSpan.style.display = "none";
};

answerButton.onclick = async () => {
    if (!allowAnswer) return;

    const callId = answerInput.value;
    const callDoc = firestore.collection('calls').doc(callId);
    const answerCandidates = callDoc.collection('answerCandidates');
    const offerCandidates = callDoc.collection('offerCandidates');

    const callData = (await callDoc.get()).data();

    if (callData) {
        callInput.value = callId;
        await startStreams();
        pc.onicecandidate = (event) => {
            event.candidate && answerCandidates.add(event.candidate.toJSON());
        };

        const offerDescription = callData.offer;
        await pc.setRemoteDescription(new RTCSessionDescription(offerDescription));

        const answerDescription = await pc.createAnswer();
        await pc.setLocalDescription(answerDescription);

        const answer = {
            type: answerDescription.type,
            sdp: answerDescription.sdp,
        };

        await callDoc.update({ answer });

        offerCandidates.onSnapshot((snapshot) => {
            snapshot.docChanges().forEach((change) => {
                console.log(change);
                if (change.type === 'added') {
                    let data = change.doc.data();
                    pc.addIceCandidate(new RTCIceCandidate(data));
                }
            });
        });

        content.style.display = contentDisplay;
        actions.style.display = "none";
    } else {
        invalididSpan.style.display = invalididDisplay;
    }
};

async function createCall() {
    // Reference Firestore collections for signaling
    const callDoc = firestore.collection('calls').doc();
    const offerCandidates = callDoc.collection('offerCandidates');
    const answerCandidates = callDoc.collection('answerCandidates');

    callInput.value = callDoc.id;

    // Get candidates for caller, save to db
    pc.onicecandidate = (event) => {
        event.candidate && offerCandidates.add(event.candidate.toJSON());
    };

    // Create offer
    const offerDescription = await pc.createOffer();
    await pc.setLocalDescription(offerDescription);

    const offer = {
        sdp: offerDescription.sdp,
        type: offerDescription.type,
    };

    await callDoc.set({ offer });

    // Listen for remote answer
    callDoc.onSnapshot((snapshot) => {
        const data = snapshot.data();
        if (!pc.currentRemoteDescription && data?.answer) {
            const answerDescription = new RTCSessionDescription(data.answer);
            pc.setRemoteDescription(answerDescription);
        }
    });

    // When answered, add candidate to peer connection
    answerCandidates.onSnapshot((snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === 'added') {
                const candidate = new RTCIceCandidate(change.doc.data());
                pc.addIceCandidate(candidate);
            }
        });
    });
}

async function startStreams() {
    pc = new RTCPeerConnection(servers);
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    remoteStream = new MediaStream();

    // Push tracks from local stream to peer connection
    localStream.getTracks().forEach((track) => {
        if (track.kind == "video") {
            pc.addTrack(track, localStream);
        }
    });

    // Pull tracks from remote stream, add to video stream
    pc.ontrack = (event) => {
        event.streams[0].getTracks().forEach((track) => {
            remoteStream.addTrack(track);
        });
    };

    webcamVideo.srcObject = localStream;
    remoteVideo.srcObject = remoteStream;
}

function endCall() {
    // Remove tracks from local stream to peer connection
    pc.close();

    webcamVideo.srcObject = null;
    remoteVideo.srcObject = null;
    webcamButton.textContent = "Start Video Call";
    content.style.display = "none";
    actions.style.display = actionsDisplay;
}
