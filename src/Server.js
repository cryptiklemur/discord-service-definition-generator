import express from "express";
import Parser from "./Parser";

const app  = express(),
      port = process.env.PORT || 3000;

export class Server {
    static async start() {
        Server.definition = {};
        const parser      = new Parser();
        
        app.get('/', async(req, res) => {
            try {
                res.json(this.definition);
            } catch (e) {
                res.json({success: false, error: e});
                console.error(e);
            }
        });
        
        app.get('/refresh', async(req, res) => {
            Server.definition = await parser.getDefinition();
            res.redirect('/')
        });
        
        Server.definition = await parser.getDefinition();
        
        return [app.listen(port, () => console.log(`Listening on http://localhost:${port}`)), parser];
    }
}
