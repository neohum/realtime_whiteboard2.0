// 캔버스 및 컨텍스트 설정
const canvas = document.getElementById('whiteboard');
const ctx = canvas.getContext('2d');

// 컨트롤 요소들
const penBtn = document.getElementById('pen-btn');
const eraserBtn = document.getElementById('eraser-btn');
const colorPicker = document.getElementById('color-picker');
const penSize = document.getElementById('pen-size');
const sizeValue = document.getElementById('size-value');
const clearBtn = document.getElementById('clear-btn');
const toolbar = document.getElementById('toolbar');
const toolbarHeader = document.getElementById('toolbar-header');
const connectionStatus = document.getElementById('connection-status');

// 그리기 상태 변수
let drawing = false;
let currentTool = 'pen'; // 'pen' 또는 'eraser'
let lastX, lastY; // 마지막 좌표 저장 변수

// 초기화 설정
ctx.lineWidth = 2;
ctx.lineCap = 'round';
ctx.strokeStyle = '#000';

// 캔버스 크기를 화면에 맞게 설정
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

// 초기 캔버스 크기 설정
resizeCanvas();

// 창 크기가 변경될 때 캔버스 크기도 조정
window.addEventListener('resize', resizeCanvas);

// 도구 상자 드래그 기능 구현
let isDragging = false;
let offsetX, offsetY;

toolbarHeader.addEventListener('mousedown', (e) => {
    isDragging = true;
    offsetX = e.clientX - toolbar.getBoundingClientRect().left;
    offsetY = e.clientY - toolbar.getBoundingClientRect().top;
    toolbar.style.cursor = 'grabbing';
});

document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    
    const x = e.clientX - offsetX;
    const y = e.clientY - offsetY;
    
    // 화면 경계를 벗어나지 않도록 제한
    const maxX = window.innerWidth - toolbar.offsetWidth;
    const maxY = window.innerHeight - toolbar.offsetHeight;
    
    toolbar.style.left = `${Math.max(0, Math.min(x, maxX))}px`;
    toolbar.style.top = `${Math.max(0, Math.min(y, maxY))}px`;
});

document.addEventListener('mouseup', () => {
    if (isDragging) {
        isDragging = false;
        toolbar.style.cursor = 'default';
    }
});

// 연결 상태 표시 함수
function showConnectionStatus(status, color) {
    if (!connectionStatus) return;
    
    connectionStatus.textContent = `상태: ${status}`;
    connectionStatus.style.backgroundColor = color;
    connectionStatus.style.color = (color === 'orange') ? 'black' : 'white';
    connectionStatus.style.padding = '5px';
    connectionStatus.style.borderRadius = '3px';
}

// 소켓 초기화 함수
function initializeSocket() {
    const roomCode = getCurrentRoomCode();
    const creatorId = roomCode ? localStorage.getItem(`room_${roomCode}_creator`) : null;
    
    // 소켓 연결 옵션
    const options = {
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000,
        extraHeaders: {}
    };
    
    // 생성자 ID가 있으면 헤더에 추가
    if (creatorId) {
        options.extraHeaders['x-creator-id'] = creatorId;
    }
    
    // 소켓 연결
    const socket = io(options);
    
    // 방 입장 상태 추적
    let hasJoinedRoom = false;
    
    // 연결 이벤트 리스너
    socket.on('connect', () => {
        console.log('서버에 연결되었습니다.');
        connectionStatus.textContent = '연결됨';
        connectionStatus.style.color = '#4CAF50';
        
        // 방 코드가 있고 아직 방에 입장하지 않은 경우에만 방에 입장
        if (roomCode && !hasJoinedRoom) {
            console.log(`방 ${roomCode}에 입장 시도...`);
            socket.emit('joinRoom', roomCode);
            hasJoinedRoom = true;
        }
    });
    
    // 방 입장 성공 이벤트
    socket.on('roomJoined', (data) => {
        console.log('방에 입장했습니다:', data);
        hasJoinedRoom = true;
        
        // 방 정보 처리...
    });
    
    // 참가자 목록 관련 이벤트 리스너 제거
    
    return socket;
}

// 그리기 포인트 처리 함수
function drawPoint(point) {
    ctx.beginPath();
    ctx.moveTo(point.startX, point.startY);
    ctx.lineTo(point.endX, point.endY);
    ctx.strokeStyle = point.color;
    
    // 도구에 따라 적절한 크기 설정
    if (point.tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = point.size * 6; // 지우개는 6배 크기
    } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.lineWidth = point.size;
    }
    
    ctx.stroke();
    ctx.closePath();
    
    // 현재 도구에 맞게 컨텍스트 상태 복원
    if (currentTool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
    } else {
        ctx.globalCompositeOperation = 'source-over';
    }
}

// 그리기 시작 함수
function startDrawing(e) {
    // 그리기가 비활성화되고 방 생성자가 아니면 그리기 불가
    if (!drawingEnabled && !isRoomCreator) {
        console.log('그리기가 비활성화되어 있습니다.');
        showDrawingPermissionAlert(true);
        return;
    }
    
    drawing = true;
    const rect = canvas.getBoundingClientRect();
    lastX = e.clientX - rect.left;
    lastY = e.clientY - rect.top;
}

// 그리기 함수
function draw(e) {
    if (!drawing) return;
    
    // 그리기가 비활성화되고 방 생성자가 아니면 그리기 불가
    if (!drawingEnabled && !isRoomCreator) {
        drawing = false;
        console.log('그리기가 비활성화되어 있습니다.');
        showDrawingPermissionAlert(true);
        return;
    }
    
    e.preventDefault();
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.closePath();
    
    // 그리기 데이터 생성
    const drawData = {
        startX: lastX,
        startY: lastY,
        endX: x,
        endY: y,
        color: ctx.strokeStyle,
        size: currentTool === 'pen' ? ctx.lineWidth : ctx.lineWidth / 6, // 지우개 크기 조정 반영
        tool: currentTool
    };
    
    // 서버에 그리기 데이터 전송
    if (socket && socket.connected) {
        socket.emit('draw', drawData);
    }
    
    // 현재 좌표를 이전 좌표로 업데이트
    lastX = x;
    lastY = y;
}

// 그리기 종료 함수
function stopDrawing() {
    drawing = false;
}

// 도구 설정 함수
function setTool(tool) {
    currentTool = tool;
    
    if (tool === 'pen') {
        ctx.globalCompositeOperation = 'source-over';
        ctx.lineWidth = parseInt(penSize.value); // 기본 펜 크기 사용
        penBtn.classList.add('active');
        eraserBtn.classList.remove('active');
    } else if (tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        // 지우개 두께는 펜 크기의 6배로 설정
        ctx.lineWidth = parseInt(penSize.value) * 6;
        eraserBtn.classList.add('active');
        penBtn.classList.remove('active');
    }
}

// 색상 설정 함수
function setColor(e) {
    ctx.strokeStyle = e.target.value;
}

// 펜 크기 설정 함수
function setPenSize(e) {
    const size = parseInt(e.target.value);
    sizeValue.textContent = size;
    
    // 현재 도구에 따라 적절한 크기 설정
    if (currentTool === 'pen') {
        ctx.lineWidth = size;
    } else if (currentTool === 'eraser') {
        ctx.lineWidth = size * 6; // 지우개는 6배 크기
    }
}

// 캔버스 지우기 함수 - 모든 사용자가 사용할 수 있도록 수정
function clearCanvas() {
    // 확인 대화상자 표시
    if (confirm('정말로 모든 내용을 지우시겠습니까?')) {
        const canvas = document.getElementById('whiteboard');
        const ctx = canvas.getContext('2d');
        
        if (canvas && ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            // 서버에 캔버스 지우기 이벤트 전송
            if (socket && socket.connected) {
                socket.emit('clearCanvas');
                console.log('캔버스 지우기 요청 전송');
            }
        }
    }
}

// 다른 사용자의 캔버스 지우기 이벤트 수신 처리
socket.on('clearCanvas', (data) => {
    const canvas = document.getElementById('whiteboard');
    const ctx = canvas.getContext('2d');
    
    if (canvas && ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        console.log('다른 사용자가 캔버스를 지웠습니다.');
        
        // 알림 표시 (선택 사항)
        if (data && data.clearedBy) {
            showNotification(`다른 사용자가 캔버스를 지웠습니다.`);
        }
    }
});

// 알림 표시 함수
function showNotification(message, duration = 3000) {
    try {
        // 이미 있는 알림 요소 확인
        let notificationElement = document.getElementById('notification');
        
        if (!notificationElement) {
            // 알림 요소 생성
            notificationElement = document.createElement('div');
            notificationElement.id = 'notification';
            notificationElement.style.position = 'fixed';
            notificationElement.style.top = '20px';
            notificationElement.style.left = '50%';
            notificationElement.style.transform = 'translateX(-50%)';
            notificationElement.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
            notificationElement.style.color = 'white';
            notificationElement.style.padding = '10px 20px';
            notificationElement.style.borderRadius = '4px';
            notificationElement.style.zIndex = '1000';
            notificationElement.style.boxShadow = '0 2px 5px rgba(0, 0, 0, 0.2)';
            document.body.appendChild(notificationElement);
        }
        
        // 메시지 설정 및 표시
        notificationElement.textContent = message;
        notificationElement.style.display = 'block';
        
        // 지정된 시간 후 숨기기
        setTimeout(() => {
            notificationElement.style.display = 'none';
        }, duration);
    } catch (error) {
        console.error('알림 표시 중 오류 발생:', error);
    }
}

// 터치 이벤트 처리 함수
function handleTouchStart(e) {
    e.preventDefault();
    if (e.touches.length === 1) {
        const touch = e.touches[0];
        const mouseEvent = new MouseEvent('mousedown', {
            clientX: touch.clientX,
            clientY: touch.clientY
        });
        canvas.dispatchEvent(mouseEvent);
    }
}

function handleTouchMove(e) {
    e.preventDefault();
    if (e.touches.length === 1) {
        const touch = e.touches[0];
        const mouseEvent = new MouseEvent('mousemove', {
            clientX: touch.clientX,
            clientY: touch.clientY
        });
        canvas.dispatchEvent(mouseEvent);
    }
}

function handleTouchEnd(e) {
    e.preventDefault();
    const mouseEvent = new MouseEvent('mouseup', {});
    canvas.dispatchEvent(mouseEvent);
}

// 이미지 붙여넣기 관련 변수
let pastedImage = null;

// 이미지 데이터 압축 및 처리 함수
function compressAndProcessImage(img, callback) {
    // 이미지 크기 조정 (필요시)
    const maxWidth = 800; // 최대 너비 제한
    const maxHeight = 600; // 최대 높이 제한
    let width = img.width;
    let height = img.height;
    
    // 이미지가 너무 크면 비율 유지하며 크기 조정
    if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = Math.floor(width * ratio);
        height = Math.floor(height * ratio);
    }
    
    // 이미지를 캔버스 중앙에 그리기
    const x = Math.floor((canvas.width - width) / 2);
    const y = Math.floor((canvas.height - height) / 2);
    
    // 캔버스에 이미지 그리기
    ctx.drawImage(img, x, y, width, height);
    
    // 이미지 데이터 압축을 위한 임시 캔버스 생성
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(img, 0, 0, width, height);
    
    // 압축된 이미지 데이터 생성 (품질 0.3으로 더 낮춤)
    const compressedImageData = tempCanvas.toDataURL('image/jpeg', 0.3);
    
    // 이미지 데이터 생성
    const imageData = {
        imageData: compressedImageData,
        x: x,
        y: y,
        width: width,
        height: height,
        timestamp: Date.now(),
        userId: socket.id,
        synced: false
    };
    
    // 이미지 데이터 크기 확인
    console.log('압축된 이미지 데이터 크기:', Math.round(compressedImageData.length / 1024), 'KB');
    
    // 이미지 데이터가 1MB보다 크면 더 압축
    if (compressedImageData.length > 1024 * 1024) {
        console.log('이미지가 너무 큽니다. 더 압축합니다.');
        
        // 더 작은 크기로 조정
        const scaleFactor = Math.sqrt(1024 * 1024 / compressedImageData.length);
        const newWidth = Math.floor(width * scaleFactor);
        const newHeight = Math.floor(height * scaleFactor);
        
        const smallerCanvas = document.createElement('canvas');
        smallerCanvas.width = newWidth;
        smallerCanvas.height = newHeight;
        const smallerCtx = smallerCanvas.getContext('2d');
        smallerCtx.drawImage(img, 0, 0, newWidth, newHeight);
        
        // 더 낮은 품질로 압축
        const moreCompressedImageData = smallerCanvas.toDataURL('image/jpeg', 0.2);
        
        // 새 이미지 데이터로 업데이트
        imageData.imageData = moreCompressedImageData;
        imageData.width = newWidth;
        imageData.height = newHeight;
        imageData.x = Math.floor((canvas.width - newWidth) / 2);
        imageData.y = Math.floor((canvas.height - newHeight) / 2);
        
        console.log('재압축된 이미지 데이터 크기:', Math.round(moreCompressedImageData.length / 1024), 'KB');
        
        // 캔버스에 다시 그리기
        ctx.clearRect(x, y, width, height);
        ctx.drawImage(img, imageData.x, imageData.y, newWidth, newHeight);
    }
    
    callback(imageData);
}

// 클립보드 붙여넣기 이벤트 처리
document.addEventListener('paste', (e) => {
    // 클립보드 데이터 가져오기
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    
    // 클립보드 항목 순회
    for (const item of items) {
        // 이미지 타입인지 확인
        if (item.type.indexOf('image') === 0) {
            e.preventDefault();
            
            // 이미지 파일 가져오기
            const blob = item.getAsFile();
            
            // 파일 크기 확인 (10MB 제한)
            if (blob.size > 10 * 1024 * 1024) {
                showError('이미지 크기가 너무 큽니다. 10MB 이하의 이미지를 사용해주세요.');
                return;
            }
            
            console.log('이미지 붙여넣기 처리 중...');
            showLoading('이미지 처리 중...');
            
            // 이미지를 데이터 URL로 변환
            const reader = new FileReader();
            reader.onload = function(event) {
                // 이미지 객체 생성
                const img = new Image();
                img.onload = function() {
                    // 이미지 압축 및 처리
                    compressAndProcessImage(img, function(imageData) {
                        hideLoading();
                        
                        // 현재 방 코드 가져오기
                        const roomCode = getCurrentRoomCode();
                        
                        // 로컬 스토리지에 이미지 저장
                        if (roomCode) {
                            saveImageToLocalStorage(roomCode, imageData);
                        }
                        
                        // 이미지 데이터를 청크로 나누어 전송
                        if (socket && socket.connected) {
                            sendImageInChunks(imageData, roomCode);
                        } else {
                            console.error('소켓이 연결되어 있지 않습니다.');
                            showError('서버 연결이 끊어졌습니다. 페이지를 새로고침해 주세요.');
                        }
                    });
                };
                img.onerror = function(error) {
                    hideLoading();
                    console.error('이미지 로드 오류:', error);
                    showError('이미지를 로드할 수 없습니다.');
                };
                img.src = event.target.result;
            };
            reader.onerror = function(error) {
                hideLoading();
                console.error('파일 읽기 오류:', error);
                showError('이미지 파일을 읽을 수 없습니다.');
            };
            reader.readAsDataURL(blob);
            break;
        }
    }
});

// 이미지 데이터를 청크로 나누어 전송
function sendImageInChunks(imageData, roomCode) {
    const MAX_CHUNK_SIZE = 50 * 1024; // 50KB 청크 크기
    const imageDataStr = imageData.imageData;
    const totalChunks = Math.ceil(imageDataStr.length / MAX_CHUNK_SIZE);
    
    console.log(`이미지 데이터 크기: ${Math.round(imageDataStr.length / 1024)}KB, ${totalChunks}개 청크로 분할`);
    
    // 메타데이터 (이미지 데이터 제외)
    const meta = {
        x: imageData.x,
        y: imageData.y,
        width: imageData.width,
        height: imageData.height,
        timestamp: imageData.timestamp,
        userId: imageData.userId
    };
    
    // 작은 이미지는 한 번에 전송
    if (totalChunks === 1) {
        console.log('이미지가 작아서 한 번에 전송합니다.');
        socket.emit('pasteImage', imageData);
        return;
    }
    
    // 청크로 나누어 전송
    for (let i = 0; i < totalChunks; i++) {
        const start = i * MAX_CHUNK_SIZE;
        const end = Math.min(start + MAX_CHUNK_SIZE, imageDataStr.length);
        const chunk = imageDataStr.substring(start, end);
        
        const chunkData = {
            chunkIndex: i,
            totalChunks: totalChunks,
            chunk: chunk,
            userId: imageData.userId,
            timestamp: imageData.timestamp,
            meta: i === 0 ? meta : null // 첫 번째 청크에만 메타데이터 포함
        };
        
        // 청크 전송
        socket.emit('imageChunk', chunkData);
        console.log(`청크 ${i + 1}/${totalChunks} 전송 완료`);
        
        // 마지막 청크 전송 후 로컬에 표시
        if (i === totalChunks - 1) {
            console.log('모든 청크 전송 완료');
        }
    }
}

// 이미지 청크 수신 처리
let imageChunks = {}; // 이미지 청크를 저장할 객체

socket.on('imageChunk', (data) => {
    const { chunkIndex, totalChunks, chunk, userId, timestamp, meta } = data;
    
    // 자신이 보낸 청크는 무시
    if (userId === socket.id) {
        return;
    }
    
    // 이미지 청크 저장 객체 초기화
    if (chunkIndex === 0) {
        imageChunks[timestamp] = {
            chunks: new Array(totalChunks),
            meta: meta,
            received: 0
        };
    }
    
    // 청크 저장
    if (imageChunks[timestamp]) {
        imageChunks[timestamp].chunks[chunkIndex] = chunk;
        imageChunks[timestamp].received++;
        
        // 모든 청크를 받았는지 확인
        if (imageChunks[timestamp].received === totalChunks) {
            // 이미지 데이터 재구성
            const fullImageData = imageChunks[timestamp].chunks.join('');
            const meta = imageChunks[timestamp].meta;
            
            // 이미지 그리기
            const img = new Image();
            img.onload = function() {
                ctx.drawImage(img, meta.x, meta.y, meta.width, meta.height);
                console.log('청크로 받은 이미지 그리기 완료:', meta.width, 'x', meta.height);
                
                // 현재 방 코드 가져오기
                const roomCode = getCurrentRoomCode();
                
                // 로컬 스토리지에 이미지 저장
                if (roomCode) {
                    const imageData = {
                        imageData: fullImageData,
                        x: meta.x,
                        y: meta.y,
                        width: meta.width,
                        height: meta.height,
                        timestamp: timestamp,
                        userId: userId,
                        synced: true
                    };
                    
                    saveImageToLocalStorage(roomCode, imageData);
                }
            };
            img.onerror = function(error) {
                console.error('이미지 로드 오류:', error);
                showError('이미지를 로드할 수 없습니다.');
            };
            img.src = fullImageData;
            
            // 메모리 정리
            delete imageChunks[timestamp];
        }
    }
});

// 다른 사용자가 붙여넣은 이미지 처리
function handlePastedImage(data) {
    console.log('이미지 데이터 처리 중');
    
    if (!data || !data.imageData) {
        console.error('유효하지 않은 이미지 데이터:', data);
        return;
    }
    
    const img = new Image();
    img.onload = function() {
        ctx.drawImage(img, data.x, data.y, data.width, data.height);
        console.log('이미지 그리기 완료:', data.width, 'x', data.height);
    };
    img.onerror = function(error) {
        console.error('이미지 로드 오류:', error);
        showError('이미지를 로드할 수 없습니다.');
    };
    img.src = data.imageData;
}

// 이미지 붙여넣기 이벤트 수신
socket.on('pasteImage', (data) => {
    console.log('이미지 붙여넣기 이벤트 수신', data.userId);
    
    // 자신이 보낸 이미지는 이미 그려져 있으므로 건너뜀
    if (data.userId === socket.id) {
        console.log('자신이 붙여넣은 이미지는 이미 표시되어 있습니다.');
        return;
    }
    
    // 현재 방 코드 가져오기
    const roomCode = getCurrentRoomCode();
    
    // 로컬 스토리지에 이미지 저장
    if (roomCode) {
        saveImageToLocalStorage(roomCode, data);
    }
    
    // 이미지 그리기
    handlePastedImage(data);
});

// 이미지 데이터 로드 처리
socket.on('loadImages', (images) => {
    console.log(`${images.length}개의 이미지 데이터 수신`);
    
    if (images.length === 0) {
        console.log('수신된 이미지가 없습니다.');
        return;
    }
    
    // 현재 방 코드 가져오기
    const roomCode = getCurrentRoomCode();
    
    // 로컬 스토리지 초기화 후 새로 저장
    if (roomCode) {
        clearImagesFromLocalStorage(roomCode);
        
        // 각 이미지를 로컬 스토리지에 저장
        images.forEach(imageData => {
            saveImageToLocalStorage(roomCode, imageData);
        });
    }
    
    // 이미지 그리기
    for (const imageData of images) {
        if (!imageData || !imageData.imageData) {
            console.error('유효하지 않은 이미지 데이터:', imageData);
            continue;
        }
        
        handlePastedImage(imageData);
    }
});

// 드래그 앤 드롭으로 이미지 추가 지원
canvas.addEventListener('dragover', (e) => {
    e.preventDefault();
    // 드래그 중인 요소에 시각적 피드백 제공
    canvas.style.border = '2px dashed #4CAF50';
});

canvas.addEventListener('dragleave', (e) => {
    e.preventDefault();
    // 드래그가 캔버스를 벗어나면 테두리 원래대로
    canvas.style.border = 'none';
});

canvas.addEventListener('drop', (e) => {
    e.preventDefault();
    // 테두리 원래대로
    canvas.style.border = 'none';
    
    // 드롭된 파일 가져오기
    const files = e.dataTransfer.files;
    
    if (files.length > 0) {
        const file = files[0];
        
        // 이미지 파일인지 확인
        if (file.type.match('image.*')) {
            console.log('이미지 파일 드롭됨:', file.name);
            
            const reader = new FileReader();
            
            reader.onload = function(event) {
                const img = new Image();
                img.onload = function() {
                    // 이미지 크기 조정 (필요시)
                    const maxWidth = canvas.width * 0.8;
                    const maxHeight = canvas.height * 0.8;
                    let width = img.width;
                    let height = img.height;
                    
                    // 이미지가 너무 크면 비율 유지하며 크기 조정
                    if (width > maxWidth || height > maxHeight) {
                        const ratio = Math.min(maxWidth / width, maxHeight / height);
                        width *= ratio;
                        height *= ratio;
                    }
                    
                    // 드롭된 위치에 이미지 그리기
                    const rect = canvas.getBoundingClientRect();
                    const x = e.clientX - rect.left - (width / 2);
                    const y = e.clientY - rect.top - (height / 2);
                    
                    // 캔버스에 이미지 그리기
                    ctx.drawImage(img, x, y, width, height);
                    console.log('이미지 그리기 완료:', width, 'x', height);
                    
                    // 이미지 데이터 생성
                    const imageData = {
                        imageData: event.target.result,
                        x: x,
                        y: y,
                        width: width,
                        height: height,
                        timestamp: Date.now(),
                        userId: socket.id
                    };
                    
                    // 서버에 이미지 데이터 전송
                    if (socket && socket.connected) {
                        console.log('드롭된 이미지 데이터 서버로 전송 중...');
                        socket.emit('pasteImage', imageData);
                    }
                };
                img.onerror = function(error) {
                    console.error('이미지 로드 오류:', error);
                    showError('이미지를 로드할 수 없습니다.');
                };
                img.src = event.target.result;
            };
            
            reader.readAsDataURL(file);
        } else {
            console.log('이미지 파일이 아닙니다:', file.type);
            showError('이미지 파일만 드롭할 수 있습니다.');
        }
    }
});

// 오류 메시지 표시 함수
function showError(message, duration = 5000) {
    const errorContainer = document.getElementById('errorContainer');
    const errorMessage = document.getElementById('errorMessage');
    
    if (!errorContainer || !errorMessage) {
        console.error('오류 메시지 컨테이너를 찾을 수 없습니다.');
        console.error(message);
        return;
    }
    
    errorMessage.textContent = message;
    errorContainer.style.display = 'block';
    
    // 일정 시간 후 메시지 숨기기
    setTimeout(() => {
        errorContainer.style.display = 'none';
    }, duration);
}

// 로딩 표시기 함수
function showLoading(message = '처리 중...') {
    const loadingIndicator = document.getElementById('loadingIndicator');
    const loadingMessage = document.getElementById('loadingMessage');
    
    if (!loadingIndicator || !loadingMessage) {
        console.error('로딩 표시기를 찾을 수 없습니다.');
        return;
    }
    
    loadingMessage.textContent = message;
    loadingIndicator.style.display = 'block';
}

function hideLoading() {
    const loadingIndicator = document.getElementById('loadingIndicator');
    
    if (!loadingIndicator) {
        console.error('로딩 표시기를 찾을 수 없습니다.');
        return;
    }
    
    loadingIndicator.style.display = 'none';
}

// 이벤트 리스너 설정
penBtn.addEventListener('click', () => setTool('pen'));
eraserBtn.addEventListener('click', () => setTool('eraser'));
colorPicker.addEventListener('change', setColor);
penSize.addEventListener('input', setPenSize);
clearBtn.addEventListener('click', clearCanvas);

// 마우스 이벤트 리스너
canvas.addEventListener('mousedown', startDrawing);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', stopDrawing);
canvas.addEventListener('mouseout', stopDrawing);

// 터치 이벤트 지원 추가
canvas.addEventListener('touchstart', handleTouchStart);
canvas.addEventListener('touchmove', handleTouchMove);
canvas.addEventListener('touchend', handleTouchEnd);

// 페이지 로드 시 소켓 초기화
let socket;
let isRoomCreator = false;
let drawingEnabled = true;
let creatorId = null;
let myCreatorId = null;

document.addEventListener('DOMContentLoaded', () => {
    // 현재 방 코드 가져오기
    const roomCode = getCurrentRoomCode();
    
    if (roomCode) {
        // 로컬 스토리지에서 생성자 ID 가져오기
        myCreatorId = localStorage.getItem(`room_${roomCode}_creator`);
        console.log(`내 생성자 ID: ${myCreatorId || '없음'}`);
    }
    
    // 소켓 초기화 및 전역 변수로 저장
    socket = initializeSocket();
    
    // 초기 도구 설정
    setTool('pen');
    
    // 페이지 가시성 변경 감지
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            console.log('페이지가 다시 보이게 됨, 연결 확인 중...');
            if (socket && !socket.connected) {
                console.log('연결이 끊어진 상태, 재연결 시도...');
                socket.connect();
            } else if (socket && socket.connected) {
                // 연결이 있더라도 ping을 보내 연결 상태 확인
                socket.emit('ping', () => {
                    console.log('연결 상태 확인됨');
                });
            }
        }
    });

    // 네트워크 상태 변경 감지
    window.addEventListener('online', () => {
        console.log('네트워크 연결됨, 소켓 재연결 시도...');
        if (socket && !socket.connected) {
            socket.connect();
        }
    });

    window.addEventListener('offline', () => {
        console.log('네트워크 연결 끊김');
        showConnectionStatus('네트워크 오프라인', 'red');
    });
    
    // 참가자 보기 버튼 제거
    const participantsBtn = document.getElementById('participantsBtn');
    if (participantsBtn) {
        participantsBtn.remove();
    }
    
    // 참가자 목록 모달 제거
    const participantsModal = document.getElementById('participantsModal');
    if (participantsModal) {
        participantsModal.remove();
    }
});

// 이미지 붙여넣기 안내 메시지 추가
const infoMessage = document.createElement('div');
infoMessage.className = 'info-message';
infoMessage.innerHTML = '이미지를 복사한 후 <strong>Ctrl+V</strong>로 붙여넣거나 이미지 파일을 드래그하여 놓으세요.';
infoMessage.style.position = 'absolute';
infoMessage.style.bottom = '10px';
infoMessage.style.left = '50%';
infoMessage.style.transform = 'translateX(-50%)';
infoMessage.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
infoMessage.style.color = 'white';
infoMessage.style.padding = '8px 16px';
infoMessage.style.borderRadius = '4px';
infoMessage.style.fontSize = '14px';
infoMessage.style.zIndex = '1000';
document.body.appendChild(infoMessage);

// 5초 후 안내 메시지 숨기기
setTimeout(() => {
    infoMessage.style.opacity = '0';
    infoMessage.style.transition = 'opacity 1s';
    
    // 애니메이션 완료 후 요소 제거
    setTimeout(() => {
        infoMessage.remove();
    }, 1000);
}, 5000);

// 로컬 스토리지에 이미지 저장
function saveImageToLocalStorage(roomCode, imageData) {
    try {
        // 현재 저장된 이미지 목록 가져오기
        let images = JSON.parse(localStorage.getItem(`room_${roomCode}_images`) || '[]');
        
        // 이미지 데이터 추가
        images.push(imageData);
        
        // 로컬 스토리지에 저장
        localStorage.setItem(`room_${roomCode}_images`, JSON.stringify(images));
        
        console.log(`이미지가 로컬 스토리지에 저장되었습니다. 총 ${images.length}개`);
        return true;
    } catch (error) {
        console.error('로컬 스토리지 저장 오류:', error);
        return false;
    }
}

// 로컬 스토리지에서 이미지 가져오기
function getImagesFromLocalStorage(roomCode) {
    try {
        // 저장된 이미지 목록 가져오기
        const images = JSON.parse(localStorage.getItem(`room_${roomCode}_images`) || '[]');
        console.log(`로컬 스토리지에서 ${images.length}개의 이미지를 불러왔습니다.`);
        return images;
    } catch (error) {
        console.error('로컬 스토리지 로드 오류:', error);
        return [];
    }
}

// 로컬 스토리지에서 이미지 초기화
function clearImagesFromLocalStorage(roomCode) {
    try {
        localStorage.removeItem(`room_${roomCode}_images`);
        console.log('로컬 스토리지의 이미지가 초기화되었습니다.');
        return true;
    } catch (error) {
        console.error('로컬 스토리지 초기화 오류:', error);
        return false;
    }
}

// 현재 방 코드 가져오기
function getCurrentRoomCode() {
    // URL에서 방 코드 추출
    const pathParts = window.location.pathname.split('/');
    const roomCodeIndex = pathParts.indexOf('room') + 1;
    
    if (roomCodeIndex > 0 && roomCodeIndex < pathParts.length) {
        return pathParts[roomCodeIndex];
    }
    
    return null;
}

// 방 입장 시 로컬 스토리지에서 이미지 로드
socket.on('roomJoined', (data) => {
    console.log('방에 입장했습니다:', data);
    
    // 방 정보에서 생성자 ID 저장
    creatorId = data.creatorId;
    
    // 내가 방 생성자인지 확인 (소켓 ID 또는 저장된 생성자 ID로 확인)
    isRoomCreator = (socket.id === data.creatorId) || (myCreatorId && myCreatorId === data.creatorId);
    drawingEnabled = data.drawingEnabled !== false; // undefined인 경우 true로 처리
    
    console.log(`방 생성자 여부: ${isRoomCreator}, 그리기 활성화 상태: ${drawingEnabled}`);
    
    // 방 생성자인 경우 그리기 제어 버튼과 모두 지우기 버튼 표시
    const toggleDrawingBtn = document.getElementById('toggleDrawingBtn');
    const clearBtn = document.getElementById('clearBtn');
    
    if (isRoomCreator) {
        if (toggleDrawingBtn) {
            toggleDrawingBtn.style.display = 'inline-block';
            toggleDrawingBtn.textContent = drawingEnabled ? '그리기 제한' : '그리기 허용';
            
            // 그리기 제어 버튼 이벤트 리스너
            toggleDrawingBtn.onclick = function() {
                // 그리기 상태 토글
                drawingEnabled = !drawingEnabled;
                
                // 서버에 그리기 상태 변경 알림
                socket.emit('toggleDrawing', drawingEnabled);
                
                // 버튼 텍스트 업데이트
                this.textContent = drawingEnabled ? '그리기 제한' : '그리기 허용';
                console.log(`그리기 상태 변경: ${drawingEnabled ? '활성화' : '비활성화'}`);
            };
        }
        
        if (clearBtn) {
            clearBtn.style.display = 'inline-block';
        }
    }
    
    // 그리기가 비활성화된 경우 알림 표시
    if (!drawingEnabled && !isRoomCreator) {
        showDrawingPermissionAlert(true);
    }
});

// 그리기 권한 변경 이벤트 처리
socket.on('drawingPermissionChanged', (data) => {
    console.log('그리기 권한 변경됨:', data);
    drawingEnabled = data.enabled;
    
    // 방 생성자인 경우 버튼 텍스트 업데이트
    if (isRoomCreator) {
        const toggleDrawingBtn = document.getElementById('toggleDrawingBtn');
        if (toggleDrawingBtn) {
            toggleDrawingBtn.textContent = drawingEnabled ? '그리기 제한' : '그리기 허용';
        }
    } else {
        // 일반 사용자인 경우 알림 표시
        showDrawingPermissionAlert(!drawingEnabled);
    }
    
    // 그리기가 비활성화된 경우 캔버스 스타일 변경
    if (!drawingEnabled && !isRoomCreator) {
        canvas.classList.add('canvas-disabled');
    } else {
        canvas.classList.remove('canvas-disabled');
    }
});

// 그리기 권한 알림 표시 함수
function showDrawingPermissionAlert(show) {
    const alertElement = document.getElementById('drawingPermissionAlert');
    
    if (!alertElement) {
        // 알림 요소가 없으면 생성
        const alert = document.createElement('div');
        alert.id = 'drawingPermissionAlert';
        alert.className = 'permission-alert';
        alert.style.position = 'fixed';
        alert.style.top = '70px';
        alert.style.left = '50%';
        alert.style.transform = 'translateX(-50%)';
        alert.style.backgroundColor = '#f44336';
        alert.style.color = 'white';
        alert.style.padding = '10px 20px';
        alert.style.borderRadius = '4px';
        alert.style.zIndex = '1000';
        alert.style.boxShadow = '0 2px 5px rgba(0, 0, 0, 0.2)';
        alert.style.display = show ? 'block' : 'none';
        alert.textContent = '방 생성자가 그리기 기능을 제한했습니다.';
        
        document.body.appendChild(alert);
        
        // 5초 후 알림 숨기기
        if (show) {
            setTimeout(() => {
                alert.style.display = 'none';
            }, 5000);
        }
    } else {
        alertElement.style.display = show ? 'block' : 'none';
        
        // 5초 후 알림 숨기기
        if (show) {
            setTimeout(() => {
                alertElement.style.display = 'none';
            }, 5000);
        }
    }
}

// 연결 재시도 로직 강화
socket.io.on('reconnect_attempt', (attempt) => {
    console.log(`재연결 시도 중... (${attempt}번째)`);
    showConnectionStatus(`재연결 시도 중... (${attempt})`, 'orange');
});

socket.io.on('reconnect', (attempt) => {
    console.log(`${attempt}번째 시도 후 재연결 성공`);
    showConnectionStatus('재연결됨', 'green');
    
    // 재연결 후 현재 방 코드 확인
    const roomCode = getCurrentRoomCode();
    if (roomCode) {
        // 방에 다시 입장
        socket.emit('joinRoom', roomCode);
    }
});

socket.io.on('reconnect_error', (error) => {
    console.error('재연결 오류:', error);
    showConnectionStatus('재연결 오류', 'red');
});

socket.io.on('reconnect_failed', () => {
    console.error('재연결 실패');
    showConnectionStatus('재연결 실패', 'red');
    showError('서버에 재연결할 수 없습니다. 페이지를 새로고침해 주세요.');
});

// 서버 오류 처리
socket.on('error', (data) => {
    console.error('서버 오류:', data);
    
    // Redis 연결 오류인 경우 특별 처리
    if (data.message && data.message.includes('Redis')) {
        showError('서버 데이터베이스 연결 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
        
        // 5초 후 페이지 새로고침
        setTimeout(() => {
            window.location.reload();
        }, 5000);
    } else {
        showError(data.message || '오류가 발생했습니다.');
    }
});

// 페이지 로드 시 스타일 추가
document.addEventListener('DOMContentLoaded', () => {
    // 기존 코드 유지...
    
    // 그리기 권한 관련 스타일 추가
    const style = document.createElement('style');
    style.textContent = `
        .canvas-disabled {
            cursor: not-allowed !important;
        }
        
        .permission-alert {
            position: fixed;
            top: 70px;
            left: 50%;
            transform: translateX(-50%);
            background-color: #f44336;
            color: white;
            padding: 10px 20px;
            border-radius: 4px;
            z-index: 1000;
            box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
            animation: fadeIn 0.3s ease-out;
        }
        
        @keyframes fadeIn {
            from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
            to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
    `;
    document.head.appendChild(style);
});
