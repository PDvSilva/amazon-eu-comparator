#!/usr/bin/env node

// Força flush imediato
process.stdout.write('🚀 WRAPPER STARTED\n');
process.stderr.write('🚀 WRAPPER STARTED (stderr)\n');

// Logs básicos
console.log('🚀 Starting application wrapper...');
console.log('📦 Node version:', process.version);
console.log('📦 Platform:', process.platform);
console.log('📦 CWD:', process.cwd());
console.log('📦 NODE_ENV:', process.env.NODE_ENV || 'not set');
console.log('📦 PORT:', process.env.PORT || 'not set');

// Força flush
process.stdout.write('📦 About to import server...\n');
setTimeout(() => {
  // Usa IIFE async para evitar problemas com top-level await
  (async () => {
    try {
      console.log('📦 Importing server module...');
      await import('./src/server.js');
      console.log('✅ Server module imported successfully');
    } catch (error) {
      console.error('❌ FATAL ERROR importing server:');
      console.error('❌ Error message:', error.message);
      console.error('❌ Error name:', error.name);
      console.error('❌ Error stack:', error.stack);
      process.exit(1);
    }
  })();
}, 50);

