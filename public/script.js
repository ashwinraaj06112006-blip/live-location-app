(() => {
  'use strict';

  const lobbyScreen = document.getElementById('lobby-screen');
  const mapScreen = document.getElementById('map-screen');

  const userNameInput = document.getElementById('user-name-input');
  const roomCodeInput = document.getElementById('room-code-input');
  const createRoomBtn = document.getElementById('create-room-btn');
  const joinRoomBtn = document.getElementById('join-room-btn');
  const lobbyError = document.getElementById('lobby-error');

  const bannerRoomCode = document.getElementById('banner-room-code');
  const bannerParticipantCount = document.getElementById('banner-participant-count');
  const leaveRoomBtn = document.getElementById('leave-room-btn');
  const statusToast = document.getElementById('status-toast');

  const socket = io();
  let map = null;
  let currentRoomCode = null;
  let currentUserName = null;
  let watchId = null;

  const markers = {}; // keyed by socket id ("self" for the current user)

  function showError(message) { lobbyError.textContent = message; }
  function clearError() { lobbyError.textContent = ''; }

  function showToast(message, autoHideMs = 2500) {
    statusToast.textContent = message;
    statusToast.style.display = 'block';
    if (autoHideMs) {
      clearTimeout(showToast._t);
      showToast._t = setTimeout(() => { statusToast.style.display = 'none'; }, autoHideMs);
    }
  }

  function setButtonsDisabled(disabled) {
    createRoomBtn.disabled = disabled;
    joinRoomBtn.disabled = disabled;
  }

  function switchToMapScreen(roomCode) {
    lobbyScreen.style.display = 'none';
    mapScreen.style.display = 'block';
    bannerRoomCode.textContent = roomCode;
    initMap();
  }

  function updateParticipantCount(count) {
    bannerParticipantCount.textContent = count;
  }

  function initMap() {
    map = L.map('map', { zoomControl: true }).setView([20.5937, 78.9629], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
  }

  function makeDivIcon(userName, isSelf) {
    return L.divIcon({
      className: '',
      html: `
        <div style="display:flex; flex-direction:column; align-items:center; gap:4px;">
          <div class="user-marker-label">${escapeHtml(userName)}${isSelf ? ' (you)' : ''}</div>
          <div class="${isSelf ? 'self-marker-icon' : 'other-marker-icon'}"></div>
        </div>
      `,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function upsertMarker(key, userName, lat, lng, isSelf) {
    const latLng = [lat, lng];
    if (markers[key]) {
      markers[key].marker.setLatLng(latLng); // smooth move, no re-creation
    } else {
      const marker = L.marker(latLng, { icon: makeDivIcon(userName, isSelf) }).addTo(map);
      marker.bindPopup(`<strong>${escapeHtml(userName)}</strong>${isSelf ? ' (you)' : ''}`);
      markers[key] = { marker, userName };
    }
  }

  function removeMarker(key) {
    if (markers[key]) {
      map.removeLayer(markers[key].marker);
      delete markers[key];
    }
  }

  function startTrackingLocation() {
    if (!navigator.geolocation) {
      showToast('Geolocation is not supported by this browser.', 4000);
      return;
    }

    watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        upsertMarker('self', currentUserName, latitude, longitude, true);

        if (!startTrackingLocation._centered) {
          map.setView([latitude, longitude], 16);
          startTrackingLocation._centered = true;
        }

        socket.emit('locationUpdate', { lat: latitude, lng: longitude, userName: currentUserName });
      },
      (error) => {
        console.error('Geolocation error:', error);
        showToast(`Location error: ${error.message}`, 4000);
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );
  }

  function stopTrackingLocation() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  }

  socket.on('locationUpdate', ({ id, userName, lat, lng }) => {
    upsertMarker(id, userName, lat, lng, false);
  });

  socket.on('participantJoined', ({ id, userName }) => {
    showToast(`${userName} joined the room`);
  });

  socket.on('participantLeft', ({ id }) => {
    const name = markers[id] ? markers[id].userName : 'A participant';
    removeMarker(id);
    showToast(`${name} left the room`);
  });

  socket.on('participantCount', (count) => { updateParticipantCount(count); });

  socket.on('connect_error', (err) => {
    console.error('Connection error:', err);
    showToast('Connection lost. Trying to reconnect...', 4000);
  });

  createRoomBtn.addEventListener('click', () => {
    clearError();
    const userName = userNameInput.value.trim();
    if (!userName) { showError('Please enter your name.'); return; }

    setButtonsDisabled(true);
    socket.emit('createRoom', { userName }, (response) => {
      setButtonsDisabled(false);
      if (!response.ok) { showError(response.error || 'Could not create room.'); return; }
      currentRoomCode = response.roomCode;
      currentUserName = userName;
      switchToMapScreen(response.roomCode);
      startTrackingLocation();
      updateParticipantCount(response.participantCount);
    });
  });

  joinRoomBtn.addEventListener('click', () => {
    clearError();
    const userName = userNameInput.value.trim();
    const roomCode = roomCodeInput.value.trim();

    if (!userName) { showError('Please enter your name.'); return; }
    if (!/^\d{6}$/.test(roomCode)) { showError('Room code must be exactly 6 digits.'); return; }

    setButtonsDisabled(true);
    socket.emit('joinRoom', { userName, roomCode }, (response) => {
      setButtonsDisabled(false);
      if (!response.ok) { showError(response.error || 'Could not join room.'); return; }
      currentRoomCode = response.roomCode;
      currentUserName = userName;
      switchToMapScreen(response.roomCode);
      startTrackingLocation();
      updateParticipantCount(response.participantCount);

      response.participants.forEach((p) => {
        if (p.lat !== null && p.lng !== null) {
          upsertMarker(p.id, p.userName, p.lat, p.lng, false);
        }
      });
    });
  });

  roomCodeInput.addEventListener('input', () => {
    roomCodeInput.value = roomCodeInput.value.replace(/\D/g, '');
  });

  leaveRoomBtn.addEventListener('click', () => {
    stopTrackingLocation();
    socket.disconnect();
    window.location.reload();
  });
})();