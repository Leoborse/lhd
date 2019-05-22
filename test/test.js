const fs          = require('fs');
const cfg =   JSON.parse( fs.readFileSync( 'test/config.json') );

const lhd         = require('../src/lhd.js');
const app = new lhd(cfg);

app.onGet('/config/:tipo/:test', getConfig, sendResponse);
app.setStatic('/','test/static');
app.start(cfg);

function getConfig(req, res){
  req.chain.next(req,res);
}

function sendResponse(req, res){
  const rsp = {
    urlparam: req.urlsec,
    server: app.cfg.server
  };
  app.response(200,rsp,req,res);
}

