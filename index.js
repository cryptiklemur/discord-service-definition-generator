require('babel-register');
const {Server} = require('./src/Server');

Server.start().then(([server]) => {
    const gracefulShutdown = function (nodemon = false) {
        console.log("Received kill signal, shutting down gracefully.");
        server.close(() => {
            console.log("Closed out remaining connections.");
            if (nodemon) {
                process.kill(process.pid, 'SIGUSR2')
            } else {
                process.exit(0);
            }
        });
        
        setTimeout(function () {
            console.error("Could not close connections in time, forcefully shutting down");
            if (nodemon) {
                process.kill(process.pid, 'SIGUSR2')
            } else {
                process.exit(1);
            }
        }, 5 * 1000);
    };
    
    process.once('SIGUSR2', gracefulShutdown.bind(undefined, true));
    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);
    
    //console.log(JSON.stringify(Server.definition, null, 4));
});
