const express = require('express');
const { createServer } = require('http');
const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Serve static files
app.use(express.static('public'));

// WebSocket terminal handler
wss.on('connection', (ws) => {
    let childProcess = null;

    ws.on('message', (message) => {
        const command = message.toString().trim();

        if (command.startsWith('node')) {
            childProcess = spawn(command.split(' ')[0], command.split(' ').slice(1));

            childProcess.stdout.on('data', (data) => {
                ws.send(data.toString());
            });

            childProcess.stderr.on('data', (data) => {
                ws.send(data.toString());
            });
        }
    });

    ws.on('close', () => {
        if (childProcess) childProcess.kill();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 