import request from "request-promise";
import cheerio from "cheerio";

export const snowflakes = ['channel.id', 'guild.id', 'message.id', 'user.id'];

export default class Parser {
    definition = {
        baseUri:    'https://discordapp.com/api',
        version:    1,
        operations: require('../custom/operations.json'),
        models:     require('../custom/models.json')
    };
    
    categories = ['channel', 'guild', 'invite', 'user', 'voice', 'webhook'];
    topics     = ['gateway', 'oauth2',];
    
    async getDefinition() {
        for (let category of this.categories.concat(this.topics)) {
            try {
                const document = await this.getCategory(category);
                
                this.definition.operations[category] = Object.assign(
                    {},
                    this.definition.operations[category],
                    await this.getOperations(category, document)
                );
                this.definition.models[category]     = Object.assign(
                    {},
                    this.definition.models[category],
                    await this.getModels(category, document)
                );
            } catch (e) {
                console.error(`Error with ${category}:`);
                console.error(e);
            }
        }
        
        return this.definition;
    }
    
    async getCategory(category) {
        let type = this.topics.indexOf(category) === -1 ? 'resources' : 'topics';
        
        const options = {
            uri:       `https://discordapp.com/developers/docs/${type}/${category}`,
            transform: function (body) {
                return cheerio.load(body);
            }
        };
        
        return await request(options)
    }
    
    async getOperations(category, $) {
        const operations = {},
              regex      = /{([A-Za-z0-9\.]+)}/g,
              meRegex    = /\[email\sprotected.*$/g;
        
        $('.http-req').each((index, element) => {
            const operation = $(element),
                  temp      = cheerio.load("<div class='temp'></div>"),
                  items     = temp('.temp');
            
            operation.nextUntil('.http-req,h2').map((i, e) => {
                items.append($(e));
            }).get();
            
            const key        = operation.find('.http-req-title').attr('id').replace(/-([a-z])/g, g => g[1].toUpperCase()),
                  name       = operation.find('.http-req-title').text(),
                  desc       = items.find('span').length > 0 ? items.find('span').eq(0) : undefined,
                  method     = operation.find('.http-req-verb').text().split('/')[0],
                  url        = operation.find('.http-req-url').text().replace(meRegex, '/@me'),
                  parameters = this.getTable($, '#json-params', items, {location: 'json'});
            
            let responseNote  = undefined,
                responseTypes = [],
                description   = '';
            if (desc !== undefined) {
                
                // Get description and responseNotes
                description = desc.text();
                let regex   = /(Return[^\.]+.)/g;
                let match   = regex.exec(description);
                if (match !== null) {
                    responseNote = match[1];
                    description  = description.replace(regex, '').trim();
                }
                
                // Get response types
                if (responseNote !== undefined) {
                    let match = regex.exec(desc.html());
                    if (match !== null) {
                        cheerio(`<div>${match[1]}</div>`).find('a').each((i, e) => {
                            let object = $(e).attr('href').split('#')[1];
                            if (object.indexOf('-object') === -1) {
                                return;
                            }
                            
                            responseTypes.push({
                                name: $(e).text(),
                                type: object.replace('-object', '')
                            });
                        });
                    }
                }
            }
            
            let match = regex.exec(url);
            while (match !== null) {
                parameters[match[1]] = {type: Parser.getTypeOfParameter(match[1]), location: 'uri', required: true};
                match                = regex.exec(url);
            }
            
            //console.log(name + ": " + url);
            operations[key] = {
                category,
                name,
                description,
                method,
                responseNote,
                responseTypes,
                url,
                parameters
            };
        });
        
        return operations;
    }
    
    
    async getModels(category, $) {
        const models = {};
        
        $('h2[id$=-object],h3[id$=-object]').each((index, element) => {
            const model = $(element),
                  key   = model.attr('id').replace('-object', '').replace(/-([a-z])/g, g => g[1].toUpperCase()),
                  type  = model.type,
                  temp  = cheerio.load("<div class='temp'></div>"),
                  items = temp('.temp');
            
            model.nextUntil(`${type}[id$=-object],h2`).map((i, e) => {
                items.append($(e));
            }).get();
            
            const description = items.children().eq(0).is('span') ? items.children().eq(0).text() : '',
                  properties  = this.getTable($, 'h6[id$=-structure]', items);
            
            models[key] = {
                category,
                description,
                type: 'object',
                properties
            };
        });
        
        return models;
    }
    
    getTable($, type, items, baseObject = {}) {
        const parameters = {},
              table      = items.find('table').eq(0);
        
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
            
            parameters[row.Field] = Object.assign({}, baseObject, {
                type:        row.Type.indexOf('array') >= 0 ? 'array' : row.Type,
                description: row.Description,
                default:     row.Default,
                required:    row.required === 'true'
            });
        });
        
        return parameters;
    }
    
    static getTypeOfParameter(parameter) {
        return snowflakes.indexOf(parameter) >= 0 ? 'snowflake' : 'string';
    }
}
