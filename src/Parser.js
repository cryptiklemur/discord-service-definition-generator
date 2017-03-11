import request from "request-promise";
import cheerio from "cheerio";
import marked from "marked";
import path from "path";
import fs from "fs";
import mkdirp from "mkdirp";

export const snowflakes = ['channel.id', 'guild.id', 'message.id', 'user.id', 'webhook.id'];
const baseUrl           = "https://raw.githubusercontent.com/hammerandchisel/discord-api-docs/master/docs";

export default class Parser {
    definition = {
        baseUri:    'https://discordapp.com/api/v6',
        version:    6,
        operations: require('../custom/operations.json'),
        models:     require('../custom/models.json')
    };
    
    categories = ['Channel', 'Guild', 'Invite', 'User', 'Voice', 'Webhook'];
    topics     = ['Gateway', 'OAuth2', 'Permissions'];
    
    static getUrl(url) {
        const regex = /{([^#]+)#[^}]+}+/;
        for (let i = 1, m = regex.exec(url); m !== null; i++, m = regex.exec(url)) {
            url = url.replace(m[0], '{' + m[1] + '}');
        }
        
        return url;
    }
    
    async getDefinition() {
        for (let category of this.categories.concat(this.topics)) {
            try {
                const document = await this.getCategory(category);
                category       = category.toLowerCase();
                
                this.definition.models[category] = Object.assign(
                    {},
                    await this.getModels(category, document),
                    this.definition.models[category]
                );
            } catch (e) {
                console.error(`Error with ${category}:`);
                console.error(e);
            }
        }
        
        for (let category of this.categories.concat(this.topics)) {
            try {
                const document = await this.getCategory(category);
                category       = category.toLowerCase();
                
                this.definition.operations[category] = Object.assign(
                    {},
                    await this.getOperations(category, document),
                    this.definition.operations[category]
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
        
        let dir  = path.join(__dirname, '..', 'cache', type);
        let file = path.join(dir, category + ".html");
        mkdirp.sync(dir);
        
        try {
            return cheerio.load(fs.readFileSync(file));
        } catch (error) {
            // https://raw.githubusercontent.com/hammerandchisel/discord-api-docs/master/docs/resources/Channel.md
            let response = await request({
                uri:       `${baseUrl}/${type}/${category}.md`,
                transform: body => cheerio.load(marked(body))
            });
            
            fs.writeFileSync(file, response.html());
            
            return response;
        }
    }
    
    async getModels(category, $) {
        let categoryType = this.topics.indexOf(category) === -1 ? 'resources' : 'topics';
        const models = {};
        
        $('h2[id$=-object],h3[id$=-object]').each((index, element) => {
            const model = $(element),
                  key   = model.attr('id').replace('-object', '').replace(/-([a-z])/g, g => g[1].toUpperCase()),
                  type  = element.name,
                  temp  = cheerio.load(`<div class="temp"></div>`);
    
            const items = temp('.temp').append(...model.nextUntil(`${type}[id$=-object],h2`).map((i, e) => e));
    
            const description = items.children().eq(0).is('p') ? items.children().eq(0).text() : '',
                  properties  = this.getTable($, items);
            
            models[key] = {
                link: `https://discordapp.com/developers/docs/${categoryType}/${category}#${model.attr('id')}`,
                category,
                description,
                type: 'object',
                properties
            };
        });
        
        return models;
    }
    
    async getOperations(category, $) {
        let categoryType = this.topics.indexOf(category) === -1 ? 'resources' : 'topics';
        
        const operations  = {},
              regex       = /{([A-Za-z0-9\.]+)}/g,
              headerRegex = /^(.*)\s%\s([A-Z\/]+)\s(.*)$/;
        
        $('h2').each((index, element) => {
            const operation = $(element);
            const temp      = cheerio.load('<div class="temp"></div>');
            
            let headerMatch = headerRegex.exec(operation.text());
            if (!headerMatch) {
                return;
            }
            
            const items = temp('.temp').append(...operation.nextUntil('h2').map((i, e) => e));
            
            const name   = headerMatch[1];
            const key    = Parser.normalizeKey(name).replace('-(deprecated)', '');
            const method = headerMatch[2].split('/')[0];
            const desc   = items.find('p').length > 0 ? items.find('p').eq(0) : undefined;
            const url    = Parser.getUrl(headerMatch[3]);
            
            let parameters = {};
            let match      = regex.exec(url);
            while (match !== null) {
                parameters[match[1]] = {type: Parser.getTypeOfUriParameter(match[1]), location: 'uri', required: true};
                match                = regex.exec(url);
            }
            parameters = Object.assign({}, parameters, this.getTable($, items));
            
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
                                type: object.replace('-object', '').replace('DOCS_', '')
                            });
                        });
                    }
                }
            }
            
            operations[key] = {
                link:          `https://discordapp.com/developers/docs/${categoryType}/${category}#${name.toLowerCase().replace(/\s/g, '-').replace('(', '').replace(')', '')}`,
                deprecated:    name.indexOf('deprecated') >= 0 ? true : undefined,
                category,
                name,
                method,
                url,
                description,
                responseNote,
                responseTypes: responseTypes.length > 0 ? responseTypes : undefined,
                parameters
            };
        });
        
        return operations;
    }
    
    getTable($, items, baseObject = {}) {
        let typeRegex = /(array of )?<a href="#DOCS_(\w+\/[\w-]+)">[\w\s]+<\/a> objects?\s?(id(?:&apos;)s?)?/;
        
        const parameters = {};
        const tables     = items.find('table');
        
        tables.each((index, table) => {
            table      = $(table);
            const type = table.prev('h6').attr('id');
            if (type.indexOf('structure') === -1 && type.indexOf('params') === -1) {
                return;
            }
            
            let location  = type.indexOf('query') >= 0 ? 'query' : 'json';
            const headers = table.find('thead').find('th').map((index, x) => $(x).text()).get();
            
            table.find('tbody > tr').each((index, element) => {
                const tr  = $(element),
                      tds = tr.find('td');
                
                let row = {};
                let advanced = false;
                headers.forEach((header, i) => {
                    if (header === 'Description') {
                        let html = $(tds[i]).html();
                        let match = typeRegex.exec(html);
                        if (match !== null) {
                            row.Type = match[3] !== undefined ? 'snowflake' : match[2].toLowerCase();
                            if (match[1] !== undefined) {
                                row.Type = `Array<${row.Type}>`;
                            }
                            advanced = true;
                        }
                    }
                    
                    if (row[header] === undefined) {
                        row[header] = $(tds[i]).text();
                    }
                });
                
                const type = Parser.normalizePropertyType(row.Type, advanced);
                
                const {Field, Type, Description, Default, required} = row;
                delete row.Field;
                delete row.Type;
                delete row.Description;
                delete row.Default;
                delete row.required;
                
                
                parameters[Field.replace('*', '').trim()] = Object.assign({}, baseObject, {
                    location,
                    type,
                    nullable:    Type.indexOf('?') >= 0 ? true : undefined,
                    description: Description,
                    default:     Parser.getDefaultForType(type, Default),
                    required:    required === undefined ? undefined : required === 'true',
                    extra:       Object.keys(row).length > 0 ? row : undefined,
                });
                
            });
        });
        
        return parameters;
    }
    
    static getDefaultForType(type, defaultValue) {
        if (type === 'integer') {
            let int = parseInt(defaultValue, 10);
            
            return isNaN(int) ? undefined : int;
        }
        
        if (type === 'bool' || type === 'boolean') {
            return defaultValue === 'true';
        }
        
        return defaultValue;
    }
    
    static normalizePropertyType(type, advanced = false) {
        switch (true) {
            default:
                return type.replace('?', '');
            case !advanced && type.indexOf('array') >= 0:
                return 'array';
            case !advanced && type.indexOf('object') >= 0:
                return 'object';
        }
    }
    
    static getTypeOfUriParameter(parameter) {
        return snowflakes.indexOf(parameter) >= 0 ? 'snowflake' : 'string';
    }
    
    static normalizeKey(key) {
        return key
            .toLowerCase()
            .replace(/\s/g, '-')
            .replace('\'', '')
            .replace('/', 'Or')
            .replace(/-([a-z])/g, g => g[1].toUpperCase())
    }
}
