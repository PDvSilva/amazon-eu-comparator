// Script wrapper ultra-simples para debug
console.log('WRAPPER: Script started');
process.stdout.write('WRAPPER: stdout write\n');
process.stderr.write('WRAPPER: stderr write\n');

// Importa o servidor diretamente
console.log('WRAPPER: About to import server.js');
import('./src/server.js')
  .then(() => {
    console.log('WRAPPER: Server imported successfully');
  })
  .catch((error) => {
    console.error('WRAPPER: FATAL ERROR:', error);
    console.error('WRAPPER: Stack:', error.stack);
    process.exit(1);
  });
