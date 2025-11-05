// Teste com CommonJS para ver se é problema de ES modules
const express = require('express');

const app = express();
const PORT = process.env.PORT || 10000;

console.log('TEST: Server starting (CommonJS)...');
console.log('TEST: PORT:', PORT);
console.log('TEST: Node version:', process.version);

process.stdout.write('TEST: stdout write\n');
process.stderr.write('TEST: stderr write\n');

app.get('/', (req, res) => {
  console.log('TEST: GET / called');
  res.json({ status: 'ok', message: 'CommonJS server working' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`TEST: Server running on port ${PORT}`);
  console.log(`TEST: Listening on http://0.0.0.0:${PORT}`);
});

console.log('TEST: Server setup complete');

// Keep process alive
process.on('SIGTERM', () => {
  console.log('TEST: SIGTERM received, shutting down');
  process.exit(0);
});

