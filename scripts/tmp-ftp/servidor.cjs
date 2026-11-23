const FtpSrv = require('/tmp/ftpsrv/node_modules/ftp-srv');
const s = new FtpSrv({ url: 'ftp://127.0.0.1:2121', anonymous: true, pasv_url: '127.0.0.1', pasv_min: 30000, pasv_max: 30050, log: require('/tmp/ftpsrv/node_modules/bunyan').createLogger({ name: 'x', level: 'fatal' }) });
s.on('login', (_d, ok) => ok({ root: '/tmp/ftpsrv/raiz' }));
s.listen().then(() => console.log('FTP escuchando en 2121'));
