const PORT = process.env.PORT || 3000;
const DOMAIN = process.env.NODE_ENV === 'production' ? 'https://rboard.schoolworks.dev' : 'http://localhost:3000';

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const { createClient } = require('redis');
const cors = require('cors');

// 환경 설정 로깅
console.log('서버 환경 설정:');
console.log(`- 포트: ${PORT}`);
console.log(`- 도메인: ${DOMAIN}`);
console.log(`- 환경: ${process.env.NODE_ENV || 'development'}`);

const app = express();
const server = http.createServer(app);

// CORS 설정 - 프로덕션 환경에서는 특정 도메인만 허용
app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? ['https://rboard.schoolworks.dev'] 
        : '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept'],
    credentials: true
}));

// JSON 파싱 미들웨어
app.use(express.json());

// 정적 파일 제공 설정
const frontendPath = path.join(__dirname, '../frontend');
console.log('프론트엔드 경로:', frontendPath);

app.use(express.static(frontendPath, {
    maxAge: '1h',
    setHeaders: (res, path) => {
        if (path.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
}));

// 로그 파일 설정
const logDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

const logFile = fs.createWriteStream(
    path.join(logDir, `server-${new Date().toISOString().split('T')[0]}.log`),
    { flags: 'a' }
);

// 로그 기록 함수
function logToFile(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    logFile.write(logMessage);
    
    // 개발 환경에서는 콘솔에도 출력
    if (process.env.NODE_ENV !== 'production') {
        console.log(`[LOG] ${message}`);
    }
}

// 서버 시작 로그
logToFile(`서버 시작 - 포트: ${PORT}, 도메인: ${DOMAIN}`);

// Redis 클라이언트 설정
let redisClient = null;
let redisEnabled = false;

// Redis 연결 설정 (선택적)
(async () => {
    try {
        // 프로덕션 환경에서만 Redis 연결 시도
        if (process.env.NODE_ENV === 'production' && process.env.REDIS_URL) {
            redisClient = createClient({
                url: process.env.REDIS_URL,
                socket: {
                    connectTimeout: 3000, // 3초 연결 타임아웃
                    reconnectStrategy: (retries) => {
                        if (retries > 3) {
                            console.log('Redis 재연결 시도 중단 (3회 초과)');
                            return new Error('Redis 연결 실패');
                        }
                        return Math.min(retries * 100, 1000); // 최대 1초 대기
                    }
                }
            });

            redisClient.on('error', (err) => {
                console.error(`Redis 연결 오류: ${err}`);
                logToFile(`Redis 연결 오류: ${err}`);
                redisEnabled = false;
            });

            redisClient.on('connect', () => {
                console.log('Redis 서버에 연결되었습니다.');
                logToFile('Redis 서버에 연결되었습니다.');
                redisEnabled = true;
            });

            // 3초 타임아웃으로 연결 시도
            const connectPromise = redisClient.connect();
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Redis 연결 시간 초과')), 3000)
            );
            
            await Promise.race([connectPromise, timeoutPromise]);
            
            console.log('Redis 연결 성공');
            logToFile('Redis 연결 성공');
            redisEnabled = true;
        } else {
            console.log('Redis 연결을 건너뜁니다. 메모리 저장소만 사용합니다.');
            logToFile('Redis 연결을 건너뜁니다. 메모리 저장소만 사용합니다.');
        }
    } catch (error) {
        console.error('Redis 연결 실패:', error);
        logToFile(`Redis 연결 실패: ${error.message}`);
        console.log('Redis 없이 서버를 계속 실행합니다. 메모리 저장소만 사용됩니다.');
        redisEnabled = false;
        redisClient = null;
    }
})();

// Redis 사용 가능 여부 확인 함수
function isRedisAvailable() {
  return redisEnabled && redisClient && redisClient.isOpen;
}

// 메모리 저장소 초기화
const rooms = {};
const userRooms = new Map();
let connectedClients = 0;

// 방 코드 생성 함수
async function createUniqueRoomCode() {
    let roomCode;
    let exists = true;
    
    while (exists) {
        // 6자리 숫자 코드 생성
        roomCode = Math.floor(100000 + Math.random() * 900000).toString();
        
        // 방 존재 여부 확인
        const roomInfo = await getRoomInfo(roomCode);
        exists = !!roomInfo;
    }
    
    return roomCode;
}

// 방 생성 함수 수정
async function createRoom(roomCode, creatorId = null) {
    const now = Date.now();
    
    // 메모리에 방 정보 저장 (creatorId 추가)
    rooms[roomCode] = {
        createdAt: now,
        lastActive: now,
        users: 0,
        creatorId: creatorId,
        drawingEnabled: true // 기본적으로 그리기 활성화
    };
    
    // Redis에 방 정보 저장
    try {
        if (isRedisAvailable()) {
            const roomKey = `room:${roomCode}`;
            
            await redisClient.hSet(roomKey, {
                createdAt: now,
                lastActive: now,
                users: 0,
                creatorId: creatorId || '',
                drawingEnabled: 'true'
            });
            
            // 24시간 후 만료 설정
            await redisClient.expire(roomKey, 24 * 60 * 60);
            
            console.log(`Redis에 방 정보 저장 완료: ${roomCode}`);
        }
    } catch (error) {
        console.error(`Redis 방 정보 저장 오류:`, error);
        logToFile(`Redis 방 정보 저장 오류: ${error.message}`);
    }
    
    return rooms[roomCode];
}

// 방 정보 조회 함수 - 오류 처리 강화
async function getRoomInfo(roomCode) {
    try {
        // 메모리에서 방 정보 확인
        if (rooms[roomCode]) {
            return rooms[roomCode];
        }
        
        // Redis에서 방 정보 확인
        if (isRedisAvailable()) {
            try {
                const roomKey = `room:${roomCode}`;
                const exists = await redisClient.exists(roomKey);
                
                if (exists) {
                    const roomData = await redisClient.hGetAll(roomKey);
                    
                    // 문자열을 숫자로 변환
                    roomData.createdAt = parseInt(roomData.createdAt) || Date.now();
                    roomData.lastActive = parseInt(roomData.lastActive) || Date.now();
                    roomData.users = parseInt(roomData.users) || 0;
                    
                    // 메모리에 캐싱
                    rooms[roomCode] = roomData;
                    
                    return roomData;
                }
            } catch (error) {
                console.error(`Redis 방 정보 조회 오류:`, error);
                logToFile(`Redis 방 정보 조회 오류: ${error.message}`);
                // Redis 오류 시 null 반환 (방 생성 필요)
            }
        }
        
        return null;
    } catch (error) {
        console.error(`방 정보 조회 중 예외 발생:`, error);
        logToFile(`방 정보 조회 중 예외 발생: ${error.message}`);
        // 오류 발생 시 기본 방 정보 반환
        return {
            createdAt: Date.now(),
            lastActive: Date.now(),
            users: 0
        };
    }
}

// 그리기 데이터 저장 함수 수정
async function saveDrawingPoint(roomCode, point) {
    try {
        // Redis 사용 가능 여부 확인 함수 사용
        if (isRedisAvailable()) {
            const pointsKey = `room:${roomCode}:points`;
            
            // 그리기 데이터를 JSON 문자열로 변환하여 저장
            await redisClient.rPush(pointsKey, JSON.stringify(point));
            
            // 24시간 후 만료 설정
            await redisClient.expire(pointsKey, 24 * 60 * 60);
        }
    } catch (error) {
        console.error(`그리기 데이터 저장 오류:`, error);
        logToFile(`그리기 데이터 저장 오류: ${error.message}`);
    }
}

// 그리기 데이터 조회 함수 - 오류 처리 강화
async function getDrawingPoints(roomCode) {
    try {
        if (isRedisAvailable()) {
            const pointsKey = `room:${roomCode}:points`;
            
            // Redis에서 그리기 데이터 조회
            const pointsData = await redisClient.lRange(pointsKey, 0, -1);
            
            // JSON 문자열을 객체로 변환
            return pointsData.map(point => {
                try {
                    return JSON.parse(point);
                } catch (e) {
                    console.error('그리기 데이터 파싱 오류:', e);
                    return null;
                }
            }).filter(point => point !== null);
        }
    } catch (error) {
        console.error(`그리기 데이터 조회 오류:`, error);
        logToFile(`그리기 데이터 조회 오류: ${error.message}`);
    }
    
    return [];
}

// 그리기 데이터 삭제 함수 수정
async function clearDrawingPoints(roomCode) {
    try {
        if (isRedisAvailable()) {
            const pointsKey = `room:${roomCode}:points`;
            
            // Redis에서 그리기 데이터 삭제
            await redisClient.del(pointsKey);
            console.log(`방 ${roomCode}의 그리기 데이터 삭제 완료`);
        }
    } catch (error) {
        console.error(`그리기 데이터 삭제 오류:`, error);
        logToFile(`그리기 데이터 삭제 오류: ${error.message}`);
    }
}

// 이미지 데이터 저장 함수 수정
async function saveImage(roomCode, imageData) {
    try {
        if (isRedisAvailable()) {
            const imagesKey = `room:${roomCode}:images`;
            
            // 이미지 데이터를 JSON 문자열로 변환하여 저장
            await redisClient.rPush(imagesKey, JSON.stringify(imageData));
            
            // 24시간 후 만료 설정
            await redisClient.expire(imagesKey, 24 * 60 * 60);
            
            return true;
        }
    } catch (error) {
        console.error(`이미지 데이터 저장 오류:`, error);
        logToFile(`이미지 데이터 저장 오류: ${error.message}`);
    }
    
    return false;
}

// 이미지 데이터 조회 함수 - 오류 처리 강화
async function getImages(roomCode) {
    try {
        if (isRedisAvailable()) {
            const imagesKey = `room:${roomCode}:images`;
            
            // Redis에서 이미지 데이터 조회
            const imagesData = await redisClient.lRange(imagesKey, 0, -1);
            
            // JSON 문자열을 객체로 변환
            return imagesData.map(image => {
                try {
                    return JSON.parse(image);
                } catch (e) {
                    console.error('이미지 데이터 파싱 오류:', e);
                    return null;
                }
            }).filter(image => image !== null);
        }
    } catch (error) {
        console.error(`이미지 데이터 조회 오류:`, error);
        logToFile(`이미지 데이터 조회 오류: ${error.message}`);
    }
    
    return [];
}

// 이미지 데이터 삭제 함수 추가
async function clearImages(roomCode) {
    try {
        if (isRedisAvailable()) {
            const imagesKey = `room:${roomCode}:images`;
            
            // Redis에서 이미지 데이터 삭제
            await redisClient.del(imagesKey);
            console.log(`방 ${roomCode}의 이미지 데이터 삭제 완료`);
        }
    } catch (error) {
        console.error(`이미지 데이터 삭제 오류:`, error);
        logToFile(`이미지 데이터 삭제 오류: ${error.message}`);
    }
}

// API 라우트 정의 - 최상위에 배치
// 헬스 체크 API
app.get('/api/health', (req, res) => {
    console.log('헬스 체크 요청 받음:', req.ip);
    
    try {
        // 응답 헤더 설정
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        
        // 응답 전송
        res.status(200).json({
            status: 'ok',
            message: '서버가 정상적으로 실행 중입니다.',
            timestamp: new Date().toISOString(),
            domain: DOMAIN
        });
        
        console.log('헬스 체크 응답 전송 완료');
    } catch (error) {
        console.error('헬스 체크 처리 중 오류:', error);
        res.status(500).json({
            status: 'error',
            message: '서버 상태 확인 중 오류가 발생했습니다.'
        });
    }
});

// 새 방 생성 API - 수정하여 creatorId 저장
app.get('/api/create-room', (req, res) => {
    try {
        console.log('방 생성 요청 받음:', req.ip);
        
        // 고유한 방 코드 생성
        createUniqueRoomCode().then(roomCode => {
            // 방 생성자 ID 생성 (IP와 타임스탬프 조합)
            const creatorId = `${req.ip}-${Date.now()}`;
            
            // 방 생성 (creatorId 저장)
            createRoom(roomCode, creatorId).then(() => {
                console.log(`새 방 생성됨: ${roomCode}, 생성자: ${creatorId}`);
                logToFile(`API 호출로 새 방 생성: ${roomCode}, 생성자: ${creatorId}`);
                
                // 응답 헤더 설정
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Expires', '0');
                
                // 응답에 creatorId 포함
                res.status(200).json({ 
                    roomCode,
                    creatorId
                });
            });
        }).catch(error => {
            console.error('방 코드 생성 오류:', error);
            logToFile(`방 코드 생성 오류: ${error.message}`);
            res.status(500).json({ error: '방 생성 중 오류가 발생했습니다.' });
        });
    } catch (error) {
        console.error('방 생성 오류:', error);
        logToFile(`방 생성 오류: ${error.message}`);
        res.status(500).json({ error: '방 생성 중 오류가 발생했습니다.' });
    }
});

// 방 존재 여부 확인 API - 단순화
app.get('/api/check-room/:roomCode', (req, res) => {
    try {
        const { roomCode } = req.params;
        console.log(`방 확인 요청 받음: ${roomCode}, IP: ${req.ip}`);
        
        // 메모리에서만 확인 (빠름)
        const exists = !!rooms[roomCode];
        
        console.log(`방 ${roomCode} 존재 여부: ${exists}`);
        logToFile(`방 확인 요청: ${roomCode}, 존재: ${exists}`);
        
        // 응답 헤더 설정
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        
        // 즉시 응답 전송
        res.status(200).json({ exists });
    } catch (error) {
        console.error('방 확인 오류:', error);
        logToFile(`방 확인 오류: ${error.message}`);
        res.status(500).json({ error: '방 확인 중 오류가 발생했습니다.' });
    }
});

// Socket.IO 설정
const io = socketIo(server, {
    cors: {
        origin: process.env.NODE_ENV === 'production' 
            ? ['https://rboard.schoolworks.dev'] 
            : "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    maxHttpBufferSize: 5 * 1024 * 1024, // 5MB로 버퍼 크기 증가
    pingTimeout: 60000, // 핑 타임아웃 60초로 증가
    pingInterval: 25000 // 핑 간격 25초로 설정
});

// 메인 페이지 라우트
app.get('/', (req, res) => {
    const indexPath = path.join(frontendPath, 'index.html');
    console.log('메인 페이지 제공:', indexPath);
    res.sendFile(indexPath);
});

// 방 페이지 라우트 - 오류 처리 강화
app.get('/room/:roomCode', (req, res) => {
    try {
        const { roomCode } = req.params;
        console.log(`방 페이지 요청: ${roomCode}`);
        
        // 방 정보 확인 (비동기 처리 없이 메모리에서만 확인)
        if (!rooms[roomCode]) {
            // 방이 존재하지 않으면 즉시 생성 (메모리에만)
            const now = Date.now();
            rooms[roomCode] = {
                createdAt: now,
                lastActive: now,
                users: 0
            };
            console.log(`존재하지 않는 방에 접근 시도, 새로 생성: ${roomCode}`);
            logToFile(`존재하지 않는 방에 접근 시도, 새로 생성: ${roomCode}`);
            
            // Redis에 방 정보 저장 (비동기로 처리)
            if (isRedisAvailable()) {
                const roomKey = `room:${roomCode}`;
                
                redisClient.hSet(roomKey, {
                    createdAt: now,
                    lastActive: now,
                    users: 0
                }).then(() => {
                    return redisClient.expire(roomKey, 24 * 60 * 60);
                }).then(() => {
                    console.log(`Redis에 방 정보 저장 완료: ${roomCode}`);
                }).catch(error => {
                    console.error(`Redis 방 정보 저장 오류:`, error);
                    logToFile(`Redis 방 정보 저장 오류: ${error.message}`);
                });
            }
        }
        
        // 방 페이지 제공
        const roomPath = path.join(frontendPath, 'room.html');
        console.log('방 페이지 제공:', roomPath);
        
        // 파일 존재 여부 확인
        if (!fs.existsSync(roomPath)) {
            console.error(`방 페이지 파일을 찾을 수 없음: ${roomPath}`);
            return res.status(404).send('방 페이지 파일을 찾을 수 없습니다.');
        }
        
        res.sendFile(roomPath);
    } catch (error) {
        console.error(`방 페이지 제공 오류:`, error);
        logToFile(`방 페이지 제공 오류: ${error.message}`);
        res.status(500).send('방 접속 중 오류가 발생했습니다.');
    }
});

// Socket.IO 연결 처리
io.on('connection', (socket) => {
    let currentRoom = null;
    
    connectedClients++;
    logToFile(`사용자 연결됨: ${socket.id} (현재 연결: ${connectedClients}명)`);
    
    // 방 정보 업데이트 함수
    function updateRoomInfo(roomCode) {
        if (!rooms[roomCode]) return;
        
        // 실제 방에 연결된 소켓 수 계산
        const sockets = io.sockets.adapter.rooms.get(roomCode);
        const actualUsers = sockets ? sockets.size : 0;
        
        // 항상 실제 연결된 사용자 수로 업데이트
        if (rooms[roomCode].users !== actualUsers) {
            console.log(`방 ${roomCode}의 사용자 수 업데이트: ${rooms[roomCode].users} -> ${actualUsers}`);
            rooms[roomCode].users = actualUsers;
            
            // 마지막 활동 시간 업데이트
            rooms[roomCode].lastActive = Date.now();
            
            // 방의 모든 사용자에게 업데이트된 사용자 수 알림
            io.to(roomCode).emit('userCountUpdated', {
                users: actualUsers
            });
        }
        
        return rooms[roomCode];
    }
    
    // 방 입장 처리 - 오류 처리 강화
    socket.on('joinRoom', async (roomCode) => {
        try {
            // 이전 방에서 나가기
            if (currentRoom) {
                socket.leave(currentRoom);
                // 이전 방에서 나간 후 실제 참가자 수 업데이트
                updateRoomInfo(currentRoom);
                logToFile(`사용자 ${socket.id}가 방 ${currentRoom}에서 나감`);
                
                // 방의 다른 사용자들에게 사용자 퇴장 알림
                socket.to(currentRoom).emit('userLeft', {
                    id: socket.id,
                    timestamp: Date.now()
                });
                
                // userRooms 맵에서 이전 방 정보 제거
                userRooms.delete(socket.id);
            }
            
            // 방 정보 확인 (메모리에서 먼저 확인)
            let roomInfo = rooms[roomCode];
            
            // 메모리에 없으면 Redis에서 확인 시도
            if (!roomInfo && isRedisAvailable()) {
                try {
                    const roomKey = `room:${roomCode}`;
                    const exists = await redisClient.exists(roomKey);
                    
                    if (exists) {
                        const roomData = await redisClient.hGetAll(roomKey);
                        
                        // 문자열을 숫자로 변환
                        roomData.createdAt = parseInt(roomData.createdAt) || Date.now();
                        roomData.lastActive = parseInt(roomData.lastActive) || Date.now();
                        roomData.users = parseInt(roomData.users) || 0;
                        
                        // 메모리에 캐싱
                        rooms[roomCode] = roomData;
                        roomInfo = roomData;
                    }
                } catch (error) {
                    console.error(`Redis 방 정보 조회 오류:`, error);
                    logToFile(`Redis 방 정보 조회 오류: ${error.message}`);
                    // Redis 오류 시 무시하고 계속 진행
                }
            }
            
            // 방이 존재하지 않으면 생성 (생성자 ID 저장)
            if (!roomInfo) {
                const now = Date.now();
                rooms[roomCode] = {
                    createdAt: now,
                    lastActive: now,
                    users: 0,
                    creatorId: socket.id, // 첫 입장자를 생성자로 설정
                    drawingEnabled: true
                };
                roomInfo = rooms[roomCode];
                logToFile(`소켓 연결에서 새 방 생성: ${roomCode}, 생성자: ${socket.id}`);
                
                // Redis에 방 정보 저장 (비동기로 처리)
                if (isRedisAvailable()) {
                    const roomKey = `room:${roomCode}`;
                    
                    redisClient.hSet(roomKey, {
                        createdAt: now,
                        lastActive: now,
                        users: 0,
                        creatorId: socket.id,
                        drawingEnabled: 'true'
                    }).then(() => {
                        return redisClient.expire(roomKey, 24 * 60 * 60);
                    }).then(() => {
                        console.log(`Redis에 방 정보 저장 완료: ${roomCode}`);
                    }).catch(error => {
                        console.error(`Redis 방 정보 저장 오류:`, error);
                        logToFile(`Redis 방 정보 저장 오류: ${error.message}`);
                    });
                }
            }
            
            // 새 방에 입장
            socket.join(roomCode);
            currentRoom = roomCode;
            userRooms.set(socket.id, roomCode);
            
            // 방 정보 업데이트 (실제 참가자 수 확인)
            updateRoomInfo(roomCode);
            
            // 현재 방의 실제 참가자 수 가져오기
            const sockets = io.sockets.adapter.rooms.get(roomCode);
            const actualUsers = sockets ? sockets.size : 0;
            
            logToFile(`사용자 ${socket.id}가 방 ${roomCode}에 입장 (현재 인원: ${actualUsers}명)`);
            
            // 클라이언트에 연결 확인 메시지 전송 (방 정보 추가)
            socket.emit('roomJoined', { 
                roomCode,
                id: socket.id, 
                timestamp: Date.now(),
                users: actualUsers,
                domain: DOMAIN,
                isCreator: socket.id === roomInfo.creatorId, // 생성자 여부
                drawingEnabled: roomInfo.drawingEnabled // 그리기 활성화 상태
            });
            
            // 방의 다른 사용자들에게 새 사용자 입장 알림
            socket.to(roomCode).emit('userJoined', {
                id: socket.id,
                users: actualUsers,
                timestamp: Date.now()
            });
            
            // 방의 그리기 데이터 전송 (오류 처리 강화)
            try {
                if (isRedisAvailable()) {
                    const pointsKey = `room:${roomCode}:points`;
                    const pointsData = await redisClient.lRange(pointsKey, 0, -1);
                    
                    // JSON 문자열을 객체로 변환
                    const drawingPoints = pointsData.map(point => {
                        try {
                            return JSON.parse(point);
                        } catch (e) {
                            console.error('그리기 데이터 파싱 오류:', e);
                            return null;
                        }
                    }).filter(point => point !== null);
                    
                    socket.emit('loadDrawing', drawingPoints);
                    logToFile(`${drawingPoints.length}개의 그리기 데이터를 클라이언트에 전송했습니다.`);
                } else {
                    socket.emit('loadDrawing', []);
                }
            } catch (error) {
                console.error(`그리기 데이터 로드 오류:`, error);
                logToFile(`그리기 데이터 로드 오류: ${error.message}`);
                socket.emit('loadDrawing', []);
            }
            
            // 방의 이미지 데이터 전송 (오류 처리 강화)
            try {
                if (isRedisAvailable()) {
                    console.log(`방 ${roomCode}의 이미지 데이터 로드 시도`);
                    const imagesKey = `room:${roomCode}:images`;
                    const imagesData = await redisClient.lRange(imagesKey, 0, -1);
                    
                    // JSON 문자열을 객체로 변환
                    const images = imagesData.map(image => {
                        try {
                            return JSON.parse(image);
                        } catch (e) {
                            console.error('이미지 데이터 파싱 오류:', e);
                            return null;
                        }
                    }).filter(image => image !== null);
                    
                    console.log(`방 ${roomCode}에서 로드한 이미지 개수: ${images.length}`);
                    
                    if (images.length > 0) {
                        socket.emit('loadImages', images);
                        logToFile(`${images.length}개의 이미지 데이터를 클라이언트에 전송했습니다.`);
                    } else {
                        logToFile(`방 ${roomCode}에 저장된 이미지가 없습니다.`);
                    }
                } else {
                    socket.emit('loadImages', []);
                }
            } catch (error) {
                console.error(`이미지 데이터 로드 오류:`, error);
                logToFile(`이미지 데이터 로드 오류: ${error.message}`);
                socket.emit('loadImages', []);
            }
        } catch (error) {
            console.error(`방 입장 오류:`, error);
            logToFile(`방 입장 오류: ${error.message}`);
            socket.emit('error', { message: '방 입장 중 오류가 발생했습니다.' });
        }
    });
    
    // 그리기 데이터 요청 처리
    socket.on('requestDrawingData', async () => {
        try {
            if (!currentRoom) return;
            
            const drawingPoints = await getDrawingPoints(currentRoom);
            socket.emit('loadDrawing', drawingPoints);
            logToFile(`요청에 따라 ${drawingPoints.length}개의 그리기 데이터를 클라이언트에 전송했습니다.`);
        } catch (error) {
            logToFile(`그리기 데이터 요청 오류: ${error.message}`);
            socket.emit('error', { message: '그리기 데이터 로드 중 오류가 발생했습니다.' });
        }
    });
    
    // 이미지 데이터 요청 처리
    socket.on('requestImageData', async () => {
        try {
            if (!currentRoom) {
                socket.emit('error', { message: '방에 입장하지 않은 상태입니다. 페이지를 새로고침해 주세요.' });
                return;
            }
            
            console.log(`이미지 데이터 요청: 방 ${currentRoom}, 사용자 ${socket.id}`);
            
            const images = await getImages(currentRoom);
            console.log(`요청에 의해 로드한 이미지 개수: ${images.length}`);
            
            socket.emit('loadImages', images);
            logToFile(`요청에 따라 ${images.length}개의 이미지 데이터를 클라이언트에 전송했습니다.`);
        } catch (error) {
            console.error(`이미지 데이터 요청 오류:`, error);
            logToFile(`이미지 데이터 요청 오류: ${error.message}`);
            socket.emit('error', { message: '이미지 데이터 로드 중 오류가 발생했습니다.' });
        }
    });
    
    // 그리기 권한 제어 이벤트 추가
    socket.on('toggleDrawing', async (enabled) => {
        try {
            if (!currentRoom) {
                socket.emit('error', { message: '방에 입장하지 않은 상태입니다.' });
                return;
            }
            
            // 방 정보 확인
            const roomInfo = rooms[currentRoom];
            
            if (!roomInfo) {
                socket.emit('error', { message: '방 정보를 찾을 수 없습니다.' });
                return;
            }
            
            // 생성자 ID 확인 (소켓 ID 또는 IP 기반 생성자 ID)
            const isCreator = socket.id === roomInfo.creatorId || 
                             (socket.handshake.headers['x-creator-id'] === roomInfo.creatorId);
            
            // 생성자만 그리기 권한을 제어할 수 있음
            if (!isCreator) {
                socket.emit('error', { message: '방 생성자만 그리기 권한을 제어할 수 있습니다.' });
                return;
            }
            
            console.log(`방 ${currentRoom}의 그리기 권한 변경: ${enabled ? '활성화' : '비활성화'} (요청자: ${socket.id})`);
            logToFile(`방 ${currentRoom}의 그리기 권한 변경: ${enabled ? '활성화' : '비활성화'} (요청자: ${socket.id})`);
            
            // 그리기 상태 업데이트
            roomInfo.drawingEnabled = enabled;
            
            // Redis에도 업데이트
            if (isRedisAvailable()) {
                const roomKey = `room:${currentRoom}`;
                await redisClient.hSet(roomKey, 'drawingEnabled', enabled ? 'true' : 'false');
            }
            
            // 방의 모든 사용자에게 그리기 상태 변경 알림
            io.to(currentRoom).emit('drawingPermissionChanged', {
                enabled: enabled,
                changedBy: socket.id
            });
            
            logToFile(`방 ${currentRoom}의 그리기 권한이 ${enabled ? '활성화' : '비활성화'}되었습니다. (변경자: ${socket.id})`);
        } catch (error) {
            console.error(`그리기 권한 제어 오류:`, error);
            logToFile(`그리기 권한 제어 오류: ${error.message}`);
            socket.emit('error', { message: '그리기 권한 제어 중 오류가 발생했습니다.' });
        }
    });

    // 그리기 이벤트 수신 및 브로드캐스트 - 권한 체크 추가
    socket.on('draw', async (data) => {
        try {
            if (!currentRoom) return;
            
            // 방 정보 확인
            const roomInfo = rooms[currentRoom];
            
            if (!roomInfo) {
                console.log(`방 정보를 찾을 수 없음: ${currentRoom}`);
                return;
            }
            
            // 그리기가 비활성화되었고, 생성자가 아니면 그리기 무시
            if (roomInfo.drawingEnabled === false && socket.id !== roomInfo.creatorId) {
                console.log(`그리기 권한 없음: ${socket.id} (방: ${currentRoom})`);
                return;
            }
            
            // Redis에 그리기 데이터 저장
            await saveDrawingPoint(currentRoom, data);
            
            // 같은 방의 다른 사용자에게 그리기 데이터 브로드캐스트
            socket.to(currentRoom).emit('draw', data);
        } catch (error) {
            console.error(`그리기 데이터 처리 오류:`, error);
            logToFile(`그리기 데이터 처리 오류: ${error.message}`);
        }
    });

    // 이미지 청크 처리
    socket.on('imageChunk', async (data) => {
        try {
            if (!currentRoom) {
                socket.emit('error', { message: '방에 입장하지 않은 상태입니다. 페이지를 새로고침해 주세요.' });
                return;
            }
            
            const { chunkIndex, totalChunks } = data;
            
            // 첫 번째 청크일 때만 로그 기록
            if (chunkIndex === 0) {
                console.log(`이미지 청크 수신 시작: 방 ${currentRoom}, 사용자 ${socket.id}, 총 ${totalChunks}개 청크`);
                logToFile(`방 ${currentRoom}에서 이미지 청크 수신 시작 (사용자: ${socket.id}, 총 청크: ${totalChunks}개)`);
            }
            
            // 마지막 청크일 때 로그 기록
            if (chunkIndex === totalChunks - 1) {
                console.log(`이미지 청크 수신 완료: 방 ${currentRoom}, 사용자 ${socket.id}`);
                logToFile(`방 ${currentRoom}에서 이미지 청크 수신 완료 (사용자: ${socket.id})`);
            }
            
            // 같은 방의 다른 사용자에게 청크 전달 (자신 제외)
            socket.to(currentRoom).emit('imageChunk', data);
            
        } catch (error) {
            console.error(`이미지 청크 처리 오류:`, error);
            logToFile(`이미지 청크 처리 오류: ${error.message}`);
            socket.emit('error', { message: '이미지 청크 처리 중 오류가 발생했습니다.' });
        }
    });

    // 이미지 붙여넣기 이벤트 수신 및 브로드캐스트
    socket.on('pasteImage', async (data) => {
        try {
            if (!currentRoom) {
                socket.emit('error', { message: '방에 입장하지 않은 상태입니다. 페이지를 새로고침해 주세요.' });
                return;
            }
            
            console.log(`이미지 붙여넣기 요청 수신: 방 ${currentRoom}, 사용자 ${socket.id}`);
            logToFile(`방 ${currentRoom}에서 이미지 붙여넣기 요청 수신 (사용자: ${socket.id})`);
            
            // 사용자 ID 확인
            if (!data.userId) {
                data.userId = socket.id;
            }
            
            // 타임스탬프 추가
            if (!data.timestamp) {
                data.timestamp = Date.now();
            }
            
            // 이미지 데이터 크기 확인
            const imageSize = data.imageData ? data.imageData.length : 0;
            console.log(`이미지 데이터 크기: ${Math.round(imageSize / 1024)}KB`);
            
            // 이미지 데이터가 너무 크면 로그에 전체 데이터를 기록하지 않음
            const logData = { ...data };
            if (logData.imageData && logData.imageData.length > 100) {
                logData.imageData = `${logData.imageData.substring(0, 100)}... (${logData.imageData.length} bytes)`;
            }
            
            // 메모리에 이미지 데이터 저장
            const saved = await saveImage(currentRoom, data);
            
            if (saved) {
                console.log(`이미지 저장 성공: 방 ${currentRoom}`);
                
                // 같은 방의 다른 사용자에게 이미지 데이터 브로드캐스트 (자신 제외)
                socket.to(currentRoom).emit('pasteImage', data);
                logToFile(`방 ${currentRoom}에 pasteImage 이벤트 브로드캐스트 완료 (이미지 크기: ${data.width}x${data.height})`);
            } else {
                console.error(`이미지 저장 실패: 방 ${currentRoom}`);
                socket.emit('error', { message: '이미지 저장 중 오류가 발생했습니다.' });
            }
        } catch (error) {
            console.error(`이미지 데이터 처리 오류:`, error);
            logToFile(`이미지 데이터 처리 오류: ${error.message}`);
            socket.emit('error', { message: '이미지 처리 중 오류가 발생했습니다.' });
        }
    });

    // 캔버스 지우기 이벤트 수신 및 브로드캐스트
    socket.on('clearCanvas', async () => {
        try {
            if (!currentRoom) return;
            
            // 방 정보 확인
            const roomInfo = rooms[currentRoom];
            
            if (!roomInfo) {
                socket.emit('error', { message: '방 정보를 찾을 수 없습니다.' });
                return;
            }
            
            // 생성자 ID 확인 (소켓 ID 또는 IP 기반 생성자 ID)
            const isCreator = socket.id === roomInfo.creatorId || 
                             (socket.handshake.headers['x-creator-id'] === roomInfo.creatorId);
            
            // 방 생성자만 캔버스를 지울 수 있음
            if (!isCreator) {
                socket.emit('error', { message: '방 생성자만 캔버스를 지울 수 있습니다.' });
                return;
            }
            
            logToFile(`방 ${currentRoom}에서 캔버스 지우기 요청 수신 (요청자: ${socket.id})`);
            
            // Redis에서 그리기 및 이미지 데이터 삭제
            await clearDrawingPoints(currentRoom);
            await clearImages(currentRoom);
            
            // 같은 방의 다른 사용자에게 캔버스 지우기 이벤트 브로드캐스트
            socket.to(currentRoom).emit('clearCanvas');
            logToFile(`방 ${currentRoom}에 clearCanvas 이벤트 브로드캐스트 완료`);
        } catch (error) {
            console.error(`캔버스 지우기 오류:`, error);
            logToFile(`캔버스 지우기 오류: ${error.message}`);
            socket.emit('error', { message: '캔버스 지우기 중 오류가 발생했습니다.' });
        }
    });

    // 연결 상태 확인 핑
    socket.on('ping', (callback) => {
        if (typeof callback === 'function') {
            // 현재 방의 실제 참가자 수 가져오기
            const roomCode = userRooms.get(socket.id);
            let roomUsers = 0;
            
            if (roomCode) {
                const sockets = io.sockets.adapter.rooms.get(roomCode);
                roomUsers = sockets ? sockets.size : 0;
                
                // 방 정보 업데이트
                if (rooms[roomCode] && rooms[roomCode].users !== roomUsers) {
                    rooms[roomCode].users = roomUsers;
                }
            }
            
            callback({
                id: socket.id,
                connectedClients: connectedClients,
                roomUsers: roomUsers
            });
        } else {
            // 현재 방의 실제 참가자 수 가져오기
            const roomCode = userRooms.get(socket.id);
            let roomUsers = 0;
            
            if (roomCode) {
                const sockets = io.sockets.adapter.rooms.get(roomCode);
                roomUsers = sockets ? sockets.size : 0;
                
                // 방 정보 업데이트
                if (rooms[roomCode] && rooms[roomCode].users !== roomUsers) {
                    rooms[roomCode].users = roomUsers;
                }
            }
            
            socket.emit('pong', {
                id: socket.id,
                connectedClients: connectedClients,
                roomUsers: roomUsers
            });
        }
    });

    // 방 정보 요청 처리
    socket.on('requestRoomInfo', () => {
        const roomCode = userRooms.get(socket.id);
        if (roomCode) {
            // 현재 방의 실제 참가자 수 가져오기
            const sockets = io.sockets.adapter.rooms.get(roomCode);
            const actualUsers = sockets ? sockets.size : 0;
            
            // 방 정보 업데이트
            if (rooms[roomCode]) {
                rooms[roomCode].users = actualUsers;
            }
            
            socket.emit('roomInfo', {
                roomCode: roomCode,
                users: actualUsers,
                createdAt: rooms[roomCode] ? rooms[roomCode].createdAt : Date.now()
            });
        }
    });

    // 서버 상태 요청 처리
    socket.on('requestServerStatus', () => {
        socket.emit('serverStatus', {
            connectedClients: connectedClients,
            totalRooms: Object.keys(rooms).length
        });
    });

    // 사용자 목록 요청 처리
    socket.on('requestUsersList', () => {
        try {
            if (!currentRoom) {
                socket.emit('error', { message: '방에 입장하지 않은 상태입니다.' });
                return;
            }
            
            // 방 정보 확인
            const roomInfo = rooms[currentRoom];
            
            if (!roomInfo) {
                socket.emit('error', { message: '방 정보를 찾을 수 없습니다.' });
                return;
            }
            
            // 방에 연결된 모든 소켓 가져오기
            const socketsInRoom = io.sockets.adapter.rooms.get(currentRoom);
            
            if (!socketsInRoom) {
                socket.emit('usersList', { users: [], creatorId: roomInfo.creatorId });
                return;
            }
            
            // 소켓 ID 배열로 변환
            const users = Array.from(socketsInRoom).map(socketId => {
                return {
                    id: socketId,
                    isCreator: socketId === roomInfo.creatorId
                };
            });
            
            // 사용자 목록 전송
            socket.emit('usersList', {
                users: users,
                creatorId: roomInfo.creatorId
            });
            
        } catch (error) {
            console.error(`사용자 목록 요청 오류:`, error);
            logToFile(`사용자 목록 요청 오류: ${error.message}`);
            socket.emit('error', { message: '사용자 목록 요청 중 오류가 발생했습니다.' });
        }
    });

    // 사용자 입장 시 모든 사용자에게 업데이트된 목록 전송
    socket.on('joinRoom', async (roomCode) => {
        // 기존 코드...
        
        // 방의 모든 사용자에게 업데이트된 사용자 목록 전송
        const socketsInRoom = io.sockets.adapter.rooms.get(roomCode);
        if (socketsInRoom) {
            const users = Array.from(socketsInRoom).map(socketId => {
                return {
                    id: socketId,
                    isCreator: socketId === roomInfo.creatorId
                };
            });
            
            io.to(roomCode).emit('usersList', {
                users: users,
                creatorId: roomInfo.creatorId
            });
        }
    });

    // 사용자 퇴장 시 모든 사용자에게 업데이트된 목록 전송
    socket.on('disconnect', () => {
        // 기존 코드...
        
        // 사용자가 속한 방이 있었다면 업데이트된 사용자 목록 전송
        if (currentRoom && rooms[currentRoom]) {
            const socketsInRoom = io.sockets.adapter.rooms.get(currentRoom);
            if (socketsInRoom) {
                const users = Array.from(socketsInRoom).map(socketId => {
                    return {
                        id: socketId,
                        isCreator: socketId === rooms[currentRoom].creatorId
                    };
                });
                
                io.to(currentRoom).emit('usersList', {
                    users: users,
                    creatorId: rooms[currentRoom].creatorId
                });
            }
        }
    });

    // 오류 처리
    socket.on('error', (error) => {
        logToFile(`소켓 오류: ${error}`);
    });

    // 연결 종료 처리
    socket.on('disconnect', async (reason) => {
        connectedClients--;
        
        try {
            // 방에서 나가기 처리
            if (currentRoom) {
                // userRooms 맵에서 사용자 정보 제거
                userRooms.delete(socket.id);
                
                // 방 정보 업데이트 (실제 참가자 수 확인)
                // 참고: disconnect 이벤트는 이미 소켓이 방에서 나간 후에 발생하므로
                // 실제 참가자 수는 이미 감소된 상태
                updateRoomInfo(currentRoom);
                
                // 현재 방의 실제 참가자 수 가져오기
                const sockets = io.sockets.adapter.rooms.get(currentRoom);
                const actualUsers = sockets ? sockets.size : 0;
                
                logToFile(`사용자 ${socket.id}가 방 ${currentRoom}에서 연결 끊김 (이유: ${reason}) (현재 인원: ${actualUsers}명)`);
                
                // 방의 다른 사용자들에게 사용자 퇴장 알림
                socket.to(currentRoom).emit('userLeft', {
                    id: socket.id,
                    users: actualUsers
                });
            } else {
                logToFile(`사용자 연결 끊김: ${socket.id} (이유: ${reason}) (현재 연결: ${connectedClients}명)`);
            }
        } catch (error) {
            logToFile(`연결 종료 처리 오류: ${error.message}`);
        }
    });

    // 연결 설정 시 초기화 메시지 전송
    socket.emit('connectionEstablished', {
        message: '서버에 연결되었습니다.',
        socketId: socket.id,
        timestamp: new Date().toISOString()
    });
});

// 메모리 사용량 모니터링 및 관리
setInterval(() => {
    // 메모리 사용량 확인
    const memoryUsage = process.memoryUsage();
    logToFile(`메모리 사용량: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB / ${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`);
}, 300000); // 5분마다 실행

// Redis 키 만료 모니터링 설정
async function setupRedisExpireMonitoring() {
    try {
        // Redis 키 만료 이벤트 구독 설정
        const subscriber = redisClient.duplicate();
        await subscriber.connect();
        
        // 키 만료 이벤트 구독
        await subscriber.configSet('notify-keyspace-events', 'Ex');
        await subscriber.subscribe('__keyevent@0__:expired', (message) => {
            logToFile(`Redis 키 만료됨: ${message}`);
            
            // 방 관련 키가 만료된 경우 처리
            if (message.startsWith('room:')) {
                const parts = message.split(':');
                if (parts.length >= 2) {
                    const roomCode = parts[1];
                    
                    // 메모리에서 방 정보 삭제
                    if (rooms[roomCode]) {
                        delete rooms[roomCode];
                        logToFile(`만료된 방 정보 삭제: ${roomCode}`);
                    }
                }
            }
        });
        
        logToFile('Redis 키 만료 모니터링 설정 완료');
    } catch (error) {
        logToFile(`Redis 키 만료 모니터링 설정 오류: ${error.message}`);
    }
}

// 서버 상태 모니터링 및 연결 정리
setInterval(async () => {
    console.log(`현재 연결된 클라이언트: ${connectedClients}명`);
    console.log(`활성화된 방 수: ${Object.keys(rooms).length}개`);
    
    // 방 참가자 수 검증 및 수정
    for (const [roomCode, room] of Object.entries(rooms)) {
        // 실제 방에 연결된 소켓 수 계산
        const sockets = io.sockets.adapter.rooms.get(roomCode);
        const actualUsers = sockets ? sockets.size : 0;
        
        // 항상 실제 연결된 사용자 수로 업데이트
        if (room.users !== actualUsers) {
            console.log(`방 ${roomCode}의 사용자 수 업데이트: ${room.users} -> ${actualUsers}`);
            room.users = actualUsers;
            
            // Redis에도 업데이트
            try {
                const roomKey = `room:${roomCode}`;
                const exists = await redisClient.exists(roomKey);
                
                if (exists) {
                    await redisClient.hSet(roomKey, 'users', actualUsers);
                    await redisClient.hSet(roomKey, 'lastActive', Date.now());
                    
                    // 사용자가 있으면 만료 시간 제거, 없으면 2시간 설정
                    if (actualUsers > 0) {
                        await redisClient.persist(roomKey);
                    } else {
                        await redisClient.expire(roomKey, 2 * 60 * 60);
                    }
                }
            } catch (error) {
                logToFile(`Redis 방 정보 업데이트 오류: ${error.message}`);
            }
            
            // 방의 모든 사용자에게 업데이트된 사용자 수 알림
            io.to(roomCode).emit('userCountUpdated', {
                users: actualUsers
            });
        }
    }
    
    // 빈 방 정리 (선택 사항)
    for (const [roomCode, room] of Object.entries(rooms)) {
        if (room.users <= 0) {
            // 마지막 활동 시간이 1시간 이상 지난 빈 방 삭제
            const inactiveTime = Date.now() - room.lastActive;
            if (inactiveTime > 60 * 60 * 1000) { // 1시간
                console.log(`비활성 방 삭제: ${roomCode} (마지막 활동: ${new Date(room.lastActive).toISOString()})`);
                
                try {
                    // Redis에서 방 관련 데이터 삭제
                    const roomKey = `room:${roomCode}`;
                    const pointsKey = `room:${roomCode}:points`;
                    const imagesKey = `room:${roomCode}:images`;
                    
                    await redisClient.del(roomKey);
                    await redisClient.del(pointsKey);
                    await redisClient.del(imagesKey);
                    
                    // 메모리에서 방 정보 삭제
                    delete rooms[roomCode];
                    
                    logToFile(`비활성 방 데이터 삭제 완료: ${roomCode}`);
                } catch (error) {
                    logToFile(`방 데이터 삭제 오류: ${error.message}`);
                }
            }
        }
    }
}, 60000); // 1분마다 실행

// 서버 종료 시 정리
process.on('SIGINT', async () => {
    logToFile('서버 종료 중...');
    
    try {
        await redisClient.quit();
        logToFile('Redis 연결 종료됨');
    } catch (error) {
        logToFile(`Redis 연결 종료 오류: ${error.message}`);
    }
    
    logFile.end();
    process.exit(0);
});

// 서버 시작
server.listen(PORT, () => {
    console.log(`서버가 ${PORT} 포트에서 실행 중입니다`);
    console.log(`http://localhost:${PORT}에서 접속 가능합니다`);
    console.log(`도메인: ${DOMAIN}`);
    
    // Redis 상태 확인
    console.log(`Redis 사용 가능 여부: ${isRedisAvailable() ? '예' : '아니오'}`);
    
    // 등록된 라우트 출력
    console.log('등록된 API 엔드포인트:');
    app._router.stack.forEach(r => {
        if (r.route && r.route.path) {
            console.log(`${Object.keys(r.route.methods).join(', ').toUpperCase()} ${r.route.path}`);
        }
    });
    
    // 서버 시작 시 초기화
    connectedClients = 0;
    
    // 모든 방 정보 초기화
    for (const roomCode in rooms) {
        rooms[roomCode].users = 0;
    }
    
    console.log('서버 상태 초기화 완료');
    logToFile('서버 시작 및 초기화 완료');
});

// 오류 처리 미들웨어 추가
app.use((err, req, res, next) => {
    console.error('서버 오류:', err);
    logToFile(`서버 오류: ${err.message}\n${err.stack}`);
    
    res.status(500).json({
        status: 'error',
        message: '서버 내부 오류가 발생했습니다.',
        error: process.env.NODE_ENV === 'production' ? '서버 오류' : err.message
    });
});

// 404 처리 미들웨어
app.use((req, res) => {
    console.log(`404 Not Found: ${req.method} ${req.url}`);
    logToFile(`404 Not Found: ${req.method} ${req.url}`);
    
    // API 요청인 경우 JSON 응답
    if (req.url.startsWith('/api/')) {
        return res.status(404).json({
            status: 'error',
            message: '요청한 API 엔드포인트를 찾을 수 없습니다.'
        });
    }
    
    // 그 외에는 메인 페이지로 리다이렉트
    res.redirect('/');
});
