const request = require('request-promise'),
      cheerio = require('cheerio'),
      express = require('express'),
      app     = express(),
      port    = process.env.PORT || 3000;

const snowflakes = ['channel.id', 'guild.id', 'message.id', 'user.id'];

async function main() {
    const definition = {
        baseUri:    'https://discordapp.com/api',
        version:    1,
        operations: [],
        models:     []
    };
    
    const categories = ['channel', 'guild', 'invite', 'user', 'voice', 'webhook'];
    
    for (let category of categories) {
        try {
            const document        = await getCategory(category);
            definition.operations = Object.assign({}, definition.operations, await getOperations(category, document));
        } catch (e) {
            console.error(`Error with ${category}:`);
            console.error(e);
        }
    }
    
    return definition;
}

async function getCategory(category) {
    const options = {
        uri:       'https://discordapp.com/developers/docs/resources/' + category,
        transform: function (body) {
            return cheerio.load(body);
        }
    };
    
    return await request(options)
}

async function getOperations(category, $) {
    const operations = {},
          regex      = /{([A-Za-z0-9\.]+)}/g,
          meRegex    = /\[email\sprotected.*$/g;
    
    $('.http-req').each((index, element) => {
        const operation = $(element),
              temp      = cheerio.load("<div class='temp'></div>"),
              items     = temp('.temp');
        
        operation.nextUntil('.http-req').map((i, e) => {
            items.append($(e));
        }).get();
        
        const key         = operation.find('.http-req-title').attr('id').replace(/-([a-z])/g, g => g[1].toUpperCase()),
              description = (items.find('span') || {text: () => ""}).text(),
              name        = operation.find('.http-req-title').text(),
              method      = operation.find('.http-req-verb').text().split('/')[0],
              url         = operation.find('.http-req-url').text().replace(meRegex, '/@me'),
              parameters  = getJsonParams($, operation, items);
        
        //console.log(name, items.find('#json-params').length);
        
        let match = regex.exec(url);
        while (match !== null) {
            parameters[match[1]] = {type: getTypeOfParameter(match[1]), location: 'uri'};
            match                = regex.exec(url);
        }
        
        //console.log(name + ": " + url);
        operations[key] = {
            category,
            name,
            description,
            method,
            url,
            parameters
        };
    });
    
    return operations;
}

function getJsonParams($, operation, items) {
    const parameters = {},
          table      = items.find('#json-params').length === 1 ? items.find('table') : undefined;
    
    
    if (!table) {
        return parameters;
    }
    
    const headers = table.find('thead').find('th').map((index, x) => $(x).text()).get();
    
    table.find('tbody > tr').each((index, element) => {
        const tr  = $(element),
              tds = tr.find('td');
        
        let row = {};
        headers.forEach((header, i) => {
            row[header] = $(tds[i]).text();
        });
        
        parameters[row.Field] = {
            type:        row.Type,
            description: row.Description,
            default:     row.Default,
            required:    row.required || false,
            location:    'json'
        };
    });
    
    return parameters;
}

function getTypeOfParameter(parameter) {
    return snowflakes.indexOf(parameter) >= 0 ? 'snowflake' : 'string';
}

app.get('/', async(req, res) => {
    try {
        res.send(JSON.stringify(await main(), null, 4));
    } catch (e) {
        console.error(e);
    }
});

(async () => console.log(JSON.stringify(await main(), null, 4)))();
/*
 const server           = app.listen(port, () => console.log("Listening on http://localhost:" + port)),
 gracefulShutdown = function () {
 console.log("Received kill signal, shutting down gracefully.");
 server.close(() => {
 console.log("Closed out remaining connections.");
 process.exit(0)
 });
 
 // if after
 setTimeout(function () {
 console.error("Could not close connections in time, forcefully shutting down");
 process.exit(1)
 }, 10 * 1000);
 };
 
 process.on('SIGTERM', gracefulShutdown);
 process.on('SIGINT', gracefulShutdown);
 //*/