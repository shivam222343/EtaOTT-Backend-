let io = null;

export function initializeWebSocket(socketIO) {
    io = socketIO;

    io.on('connection', (socket) => {
        console.log(`✅ Client connected: ${socket.id}`);

        // Join user-specific room
        socket.on('join:user', (userId) => {
            socket.join(`user:${userId}`);
            console.log(`User ${userId} joined their room`);
        });

        // Join institution room
        socket.on('join:institution', (institutionId) => {
            socket.join(`institution:${institutionId}`);
            console.log(`Joined institution room: ${institutionId}`);
        });

        // Join branch room
        socket.on('join:branch', (branchId) => {
            socket.join(`branch:${branchId}`);
            console.log(`Joined branch room: ${branchId}`);
        });

        // Join course room
        socket.on('join:course', (courseId) => {
            socket.join(`course:${courseId}`);
            console.log(`Joined course room: ${courseId}`);
        });

        // Leave rooms
        socket.on('leave:institution', (institutionId) => {
            socket.leave(`institution:${institutionId}`);
        });

        socket.on('leave:branch', (branchId) => {
            socket.leave(`branch:${branchId}`);
        });

        socket.on('leave:course', (courseId) => {
            socket.leave(`course:${courseId}`);
        });

        // Disconnect
        socket.on('disconnect', () => {
            console.log(`❌ Client disconnected: ${socket.id}`);
        });
    });

    return io;
}

export function getIO() {
    if (!io) {
        throw new Error('Socket.io not initialized');
    }
    return io;
}

// Helper functions to emit events

export function emitToUser(userId, event, data) {
    if (io) {
        io.to(`user:${userId}`).emit(event, data);
    }
}

export function emitToInstitution(institutionId, event, data) {
    if (io) {
        io.to(`institution:${institutionId}`).emit(event, data);
    }
}

export function emitToBranch(branchId, event, data) {
    if (io) {
        io.to(`branch:${branchId}`).emit(event, data);
    }
}

export function emitToCourse(courseId, event, data) {
    if (io) {
        io.to(`course:${courseId}`).emit(event, data);
    }
}

// Doubt-specific events
export function notifyDoubtEscalated(doubt, facultyIds) {
    if (io) {
        facultyIds.forEach(facultyId => {
            emitToUser(facultyId.toString(), 'doubt:escalated', {
                doubtId: doubt._id,
                studentId: doubt.studentId,
                query: doubt.query,
                courseId: doubt.courseId,
                timestamp: new Date()
            });
        });
    }
}

export function notifyDoubtAnswered(doubt) {
    if (io) {
        emitToUser(doubt.studentId.toString(), 'doubt:answered', {
            doubtId: doubt._id,
            answer: doubt.facultyAnswer,
            answeredBy: doubt.answeredBy,
            timestamp: new Date()
        });
    }
}

// Content upload notification
export function notifyContentUploaded(content, branchId) {
    if (io) {
        emitToBranch(branchId.toString(), 'content:uploaded', {
            contentId: content._id,
            title: content.title,
            type: content.type,
            courseId: content.courseId,
            timestamp: new Date()
        });
    }
}

// General notification
export function sendNotification(userId, notification) {
    if (io) {
        emitToUser(userId.toString(), 'notification:new', notification);
    }
}
