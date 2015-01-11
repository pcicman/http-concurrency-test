/**
 * Author: pcicman
 * Date: 09/01/15
 * Time: 17:23
 */


// Load the http module to create an http server.
var http = require('http'),
    path = require('path'),
    fs = require('fs');

var mimeTypes = {
    "html": "text/html",
    "jpg": "image/jpeg"
};

// global results cache
var results = {};

function timestamp(){
    var hrTime = process.hrtime();
    return hrTime[0] * 1e9 + hrTime[1];
}

function sendFile(req, res, fileName) {
    var mimeType = mimeTypes[path.extname(fileName).split(".").reverse()[0]];
    res.writeHead(200, {'Content-Type': mimeType} );
    var fileStream = fs.createReadStream(fileName);
    fileStream.pipe(res);
}

function getTestContent(req, res, uuid, cnt) {
    var start = timestamp(),
        end;
    req.on('end', function(){
        var end = timestamp();
        if (!results[uuid]) {
            results[uuid] = {
                client: {
                    'ip': req.connection.remoteAddress,
                    'user-agent': req.headers['user-agent']
                },
                start: Date.now(),
                data: []
            }
        }
        results[uuid].data.push([start, end, cnt]);
    });
    sendFile(req, res, 'media/test.jpg');
}

function getResults(req, res, uuid) {
    results[uuid]._done = true;
    res.writeHead(200, {"Content-Type": "text/plain"});
    var data = {};
    if (results[uuid]) {
        findMaxConcurrentRequests(uuid);
        data.data = results[uuid];
    } else {
        data.error = 'No test data';
    }

    res.end(JSON.stringify(data));
}

function findMaxConcurrentRequests(uuid) {
    if (results[uuid].concurrent) {
        return results[uuid].concurrent;
    }

    var r = results[uuid].data,
        l = r.length,
        max = 0;
    for (var i = 0; i < l; i++) {
        var c = 1;
        for (var j = i + 1; j < l; j++) {
            // intersect? -> concurrent
            if ((r[j][0] >= r[i][0] && r[j][0] <= r[i][1]) || (r[i][0] >= r[j][0] && r[i][0] <= r[j][1])) {
                c++;
            }
        }
        max = Math.max(max, c);
    }
    results[uuid].concurrent = max;
    return max;
}

var server = http.createServer(function (req, res) {
    // KISS url handler
    if (req.url === '/') {
        return sendFile(req, res, 'media/index.html');
    } else {
        var match = req.url.match(/^\/([a-z0-9-]+)\/((\d+)\/)?/);
        if (match) {
            return match[2] === undefined ? getResults(req, res, match[1]) : getTestContent(req, res, match[1], match[3]);
        }
    }
    res.writeHead(404, {"Content-Type": "text/plain"});
    res.end('Not found');
});

server.listen(process.env.PORT || 9000, process.env.HOST || '0.0.0.0');


// results cache cleaner

var INVALIDATE_AFTER = 15 * 60 * 1000; // 15 minutes
setInterval(function(){
    // clean all results older that INVALIDATE_AFTER
    var invalidate = Date.now() - INVALIDATE_AFTER;
    for (var uuid in results) {
        if (results.hasOwnProperty(uuid) && results[uuid].start < invalidate && results[uuid]._logged) {
            delete results[uuid];
        }
    }
}, INVALIDATE_AFTER);


// logger

var log = fs.createWriteStream('log.txt', {'flags': 'a'});

process.on('exit', function() {
    log.end(''); // close stream
});

var LOG = 10; // 10 seconds
setInterval(function(){
    var invalidate = Date.now() - INVALIDATE_AFTER;
    for (var uuid in results) {
        if (results.hasOwnProperty(uuid) && !results[uuid]._logged) {

            if (results[uuid]._done || results[uuid].start < invalidate) {
                // log
                var msg = [
                    (new Date(results[uuid].start)).toISOString(),
                    results[uuid].client['ip'],
                    findMaxConcurrentRequests(uuid),
                    results[uuid].data.length,
                    uuid,
                    results[uuid].client['user-agent']
                ].join('\t');
                log.write(msg + '\n');
                results[uuid]._logged = true;
            }
        }
    }
}, LOG);