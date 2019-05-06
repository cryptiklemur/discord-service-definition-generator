import request from "request-promise";
import cheerio from "cheerio";
import marked from "marked";
import path from "path";
import fs from "fs";
import mkdirp from "mkdirp";
import puppeteer from 'puppeteer';

export const snowflakes = ['channel.id', 'guild.id', 'message.id', 'user.id', 'webhook.id'];
const baseUrl           = "https://discordapp.com/developers/docs";

export default class Parser {
    definition = {
        baseUri:    'https://discordapp.com/api/v6',
        version:    6,
        operations: require('../custom/operations.json'),
        models:     require('../custom/models.json')
    };
    
    resources = ['audit-log', 'channel', 'emoji', 'guild', 'invite', 'user', 'voice', 'webhook'];
    topics    = ['gateway', 'oauth2', 'permissions'];
    
    static getUrl(url) {
        const regex = /{([^#]+)#[^}]+}+/;
        for (let i = 1, m = regex.exec(url); m !== null; i++, m = regex.exec(url)) {
            url = url.replace(m[0], '{' + m[1] + '}');
        }
        
        return url;
    }
    
    async getDefinition() {
        for (let resource of this.resources.concat(this.topics)) {
            try {
                const document = await this.getResource(resource);
                resource       = resource.toLowerCase();
                
                this.definition.models[resource] = Object.assign(
                    {},
                    await this.getModels(resource, document),
                    this.definition.models[resource]
                );
            } catch (e) {
                console.error(`Error with ${resource}:`);
                console.error(e);
            }
        }
        
        for (let resource of this.resources.concat(this.topics)) {
            try {
                const document = await this.getResource(resource);
                resource       = resource.toLowerCase();
                
                this.definition.operations[resource] = Object.assign(
                    {},
                    await this.getOperations(resource, document),
                    this.definition.operations[resource]
                );
            } catch (e) {
                console.error(`Error with ${resource}:`);
                console.error(e);
            }
        }
        
        return this.definition;
    }
    
    async getResource(resource) {
        let type = this.topics.indexOf(resource) === -1 ? 'resources' : 'topics';

        let dir = path.join(__dirname, '..', 'cache', type);
        let file = path.join(dir, resource + ".html");
        mkdirp.sync(dir);

        try {
            return cheerio.load(fs.readFileSync(file));
        } catch (error) {
            const url = `${baseUrl}/${type}/${resource}`;
            const browser = await puppeteer.launch({
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });

            const page = await browser.newPage();
            await page.goto(url);
            await page.waitForSelector('[class^=contentWrapperInner]')

            const content = await page.content()
            await browser.close();

            //fs.writeFileSync(file, content);

            return cheerio.load(content);
        }
    }
    
    async getModels(resource, $) {
        let resourceType = this.topics.indexOf(resource) === -1 ? 'resources' : 'topics';
        const models     = {};
        
        $('h2[id$=-object],h3[id$=-object]').each((index, element) => {
            const model = $(element),
                  key   = model.attr('id').replace('-object', '').replace(/-([a-z])/g, g => g[1].toUpperCase()),
                  type  = element.name,
                  temp  = cheerio.load(`<div class="temp"></div>`);
            
            const items = temp('.temp').append(...model.nextUntil(`${type}[id$=-object],h2,h3`).map((i, e) => e));
            
            const description = items.children().eq(0).is('p') ? items.children().eq(0).text() : '',
                  properties  = this.getTable($, items);
            
            models[key] = {
                link: `https://discordapp.com/developers/docs/${resourceType}/${resource}#${model.attr('id')}`,
                resource,
                description,
                type: 'object',
                properties
            };
        });
        
        return models;
    }
    
    async getOperations(resource, $) {
        let resourceType = this.topics.indexOf(resource) === -1 ? 'resources' : 'topics';
        
        const operations  = {},
              regex       = /{([A-Za-z0-9\.]+)}/g,
              headerRegex = /^(.*)\s%\s([A-Z\/]+)\s(.*)$/;
        
        $('.http-req').each((index, element) => {
            const domElement = $(element);
            const title      = domElement.find("h2");
            const name       = title.text();
            const method     = domElement.find(".http-req-verb").text();
            const url        = domElement.find(".http-req-url").text();
            const temp       = cheerio.load('<div class="temp"></div>');
            const items      = temp('.temp').append(...domElement.nextUntil('.http-req').map((i, e) => e));
            const key        = Parser.normalizeKey(name).replace('-(deprecated)', '');
            const desc       = items.find('span').length > 0 ? items.find('span').eq(0) : undefined;

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
                description   = desc.text();
                let regex     = /(Return[^\.]+.)/g;
                let listRegex = /Returns an? (?:list|array)/g;
                let match     = regex.exec(description);
                if (match !== null) {
                    responseNote = match[1];
                    description  = description.replace(regex, '').trim();
                }
                
                // Get response types
                if (responseNote !== undefined) {
                    let uriRegex = /(Return[^\.]+.+>)/g;
                    let uriMatch = uriRegex.exec(desc.html());
                    if (uriMatch !== null) {
                        cheerio(`<div>${uriMatch[0]}</div>`).find('a').each((i, e) => {
                            const href         = $(e).attr('href').split("#");
                            let returnResource = href[0].split('/').reverse()[0];
                            let object         = href[1];
                            if (object.indexOf('-object') === -1) {
                                return;
                            }
                            
                            // @todo Remove once https://github.com/discordapp/discord-api-docs/pull/501 is merged
                            if (key === 'listGuildMembers') {
                                returnResource = "guild";
                                object         = "guild-member";
                            }
                            
                            const array = listRegex.test(uriMatch[0]);
                            let type    =
                                      (array ? 'Array<' : '') +
                                      (returnResource ? (returnResource + "/") : "") +
                                      object.replace('-object', '').replace('DOCS_', '') +
                                      (array ? '>' : '');
                            
                            responseTypes.push({
                                name: $(e).text(),
                                type
                            });
                        });
                    }
                }
            }
            
            let parametersArray = false;
            if (/JSON array of parameters/.test(description)) {
                parametersArray = true;
            }
            
            operations[key] = {
                link:          `https://discordapp.com/developers/docs/${resourceType}/${resource}#${name.toLowerCase().replace(/\s/g, '-').replace('(', '').replace(')', '')}`,
                deprecated:    name.indexOf('deprecated') >= 0 ? true : undefined,
                resource,
                name,
                method,
                url,
                description,
                responseNote,
                responseTypes: responseTypes.length > 0 ? responseTypes : undefined,
                parameters,
                parametersArray
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

            if (type == undefined) {
                return;
            }

            if (type.indexOf('structure') === -1 && type.indexOf('params') === -1) {
                return;
            }
            
            let location  = type.indexOf('query') >= 0 ? 'query' : 'json';
            const headers = table.find('thead').find('th').map((index, x) => $(x).text()).get();
            
            table.find('tbody > tr').each((index, element) => {
                const tr  = $(element),
                      tds = tr.find('td');
                
                let row      = {};
                let advanced = false;
                headers.forEach((header, i) => {
                    if (header === 'Description') {
                        let html  = $(tds[i]).html();
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
        
        if (type === 'snowflake') {
            return undefined;
        }
        
        if (defaultValue === 'absent') {
            return undefined;
        }
        
        return defaultValue;
    }
    
    static normalizePropertyType(type, advanced = false) {
        switch (true) {
            default:
                return type.replace('?', '');
            case type === "ISO8601 timestamp":
                return 'ISO8601 timestamp';
            case type === "base64 image data":
            case type === "avatar data string":
                return 'string';
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
