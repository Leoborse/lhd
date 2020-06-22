/*!
 * lhd
 * Copyright(c) 2019 Leonardo Borselli
 * MIT Licensed
 */

const crypto      = require('crypto');
const fs          = require('fs');
const http        = require('http');
const https       = require('https');
const mimeType    = require('mime-types');
const path        = require('path');
const querystring = require('querystring');
const urlparser   = require('url');
const jwa         = require('jwa');


var HttpDispatcher = function(configurazione) {
  configurazione = configurazione || {};
  configurazione.dispatcher = configurazione.dispatcher || this;
  configurazione.log = configurazione.log ||
                function(m){console.log(JSON.stringify(m))};
  configurazione.uuid = configurazione.uuid || function() {
    //Lowercase ITU X.667 §6.5.4 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
    var hs = crypto.randomBytes(16).toString("hex").toLowerCase();
    var u = hs.substring(0,8) + "-" +
            hs.substring(8,12) + "-" +
            "4" + hs.substring(13,16) + "-" +
            (parseInt('0x'+hs.substring(16,17))&0x3|0x8).toString(16) +
            hs.substring(17,20) + "-" +
            hs.substring(20);
    return u
  }
  configurazione.server.header = configurazione.server.header || {
    'X-Robots-Tag': [
      'noarchive',
      'noindex, nofollow'
    ],
    'Cache-Control': [
      'no-cache', // RFC7234, https://tools.ietf.org/html/rfc7234
      'no-store',
      'no-transform',
      'private'
    ]
  }
  this.cfg = configurazione
  let cfg = this.cfg;
  try {
    var lcfg = JSON.parse(fs.readFileSync( 'package.json' ));
    cfg.name = lcfg.name;
    cfg.version = lcfg.version;
  } catch(e) {
  }
  cfg.log({
    status: "Info",
    name: "Service description",
    action: 'push',
    value: {
      name: cfg.name,
      version: cfg.version,
      environment: cfg.environment||'lhd',
    }
  });

  var config = cfg.server;
  this.services = [];
  this.listeners = {
  };
  // Pulisce url con errori evidenti // /./ /../
  this.clean = [
    {e: new RegExp('\/\.\/','g'), r: '/'},
    {e: new RegExp('\/\.\.\/','g'), r: '/'},
    {e: new RegExp('\/+','g'), r: '/'}
  ];

  this.errorListener = function(req, res) {
    if ( typeof req.error == 'undefined' ) {
      res.writeHead(404);
      res.end();
    } else {
      var status = 200;
      this.response(status,req.error,req,res);
    }
  }

/*******************************************************************************
Inizializzazione oauth2
*******************************************************************************/
  function initoauth(r,cs){
    cs.auth = cs.auth || {}
    if ( ! cs.openid )
      return
    if ( typeof cs.openid == 'string' )
      cs.openid = [cs.openid]
    const oid = JSON.parse(JSON.stringify(cs.openid))
    while (oid.length > 0) {
      r(oid.pop(),
        (oidc) => {
          authserver(r,cs,oidc)
        },
        (err) => {
          ie(err,r,c)
        }
      )
    }
  }

  function authserver(r,cs,oidc){
    function rsaPublicKeyPem(modulus_b64, exponent_b64) {
      var modulus_hex = Buffer.from(modulus_b64, 'base64').toString('hex')
      var exponent_hex = Buffer.from(exponent_b64, 'base64').toString('hex')

      const prepadSigned = function(hexStr) {
        var msb = hexStr[0]
        if (msb < '0' || msb > '7') {
          return '00'+hexStr;
        } else {
          return hexStr;
        }
      }
      const toHexDER = function(tag,value){ // ASN.1 DER TLV = Tag Length Value
        var hex = prepadSigned(value) // hex value plus left padding if required
        var n = hex.length/2
        var n_hex = n.toString(16) // hex length value
        if (n_hex.length%2) n_hex = '0'+n_hex; // padding if required
        if ( n > 127 ) n_hex = (128+n_hex.length/2).toString(16)+n_hex // ASN.1 DER length
        return tag + n_hex + hex
      }

      var hexDER = toHexDER('30',
        toHexDER('02',modulus_hex) +
        toHexDER('02',exponent_hex)
      )
      var der_b64 = Buffer.from(hexDER, 'hex').toString('base64');

      var pem = '-----BEGIN RSA PUBLIC KEY-----\n'
          + der_b64.match(/.{1,64}/g).join('\n')
          + '\n-----END RSA PUBLIC KEY-----\n';
      return pem
    }

    var iss = oidc.issuer
    r(oidc.jwks_uri,
      (rsp) => {
        cs.auth[iss] = {
          keys: {}
        }
        while( rsp.keys.length > 0 ) {
          var k = rsp.keys.pop()
          k.pem = rsaPublicKeyPem(k.n,k.e)
          cs.auth[iss].keys[k.kid] = k
        }
      },(err) => {
        ie(err,r,c)
      }
    )
  }

  function ie(m,r,c){
    cfg.log({
      status: "Error",
      code: 500,
      msg: m
    })
    setTimeout(init, 60*1000,r,c)
  }


  // Inizializzazione oauth2
  initoauth(this.request,this.cfg.server)

  // Prefix paths
  this.pre = [];
  if ( config && config.apiPaths && config.apiPaths.length ) {
    for ( var i=0; i<config.apiPaths.length; i++) {
      this.pre.push( {e: new RegExp('^'+config.apiPaths[i]+'/'), r:'/'} );
    }
    cfg.log({
      status: "Info",
      name: "Removed prefix(es)",
      value: config.apiPaths
    });
  }

  // Max file length
  this.maxlen = {
    'application/json': 10e3,
    'default': 0
  }
  for(var p in cfg.server.maxlen) {
    if (cfg.server.maxlen.hasOwnProperty(p)) {
      if( typeof cfg.server.maxlen[p] == 'number') {
        this.maxlen[p] = cfg.server.maxlen[p];
      }
    }
  }
}

HttpDispatcher.prototype.auth = function(req, res) {
  req.user = {
    sub: "Anonymous"
  }
  if ( ! req.headers ) return
  if ( req.headers['authorization'] ) {
    const a = req.headers['authorization'].replace(/ +/g," ").split(" ")
    req.auth = {
      type: a[0].toLowerCase(),
      value: a[1]
    }
    if ( req.auth.type == 'bearer' ) {
      try {
        const jwt = req.auth.value
        const header = Buffer.from(jwt.split('.')[0], 'base64').toString('utf8')
        const token = Buffer.from(jwt.split('.')[1], 'base64').toString('utf8')
        var user = JSON.parse(token)
        user.header =  JSON.parse(header)
        user.token = req.auth.value
        user.type = req.auth.type
        // Verifica token
        const obj = user.token
        const key = req.cfg.server.auth[user.iss].keys[user.header.kid]
        const alg = key.alg // user.header.alg
        var firma = obj.split('.')[2]
        var dati = obj.split('.', 2).join('.')
        var algo = jwa(alg);
        if ( alg != 'none' && algo.verify(dati, firma, key.pem) ) {
          req.user = JSON.parse(JSON.stringify(user))
        }
      } catch(e) {
        req.cfg.log({
          reqid: req.reqid,
          msg: "error parsing token",
          value: e
        })
      }
    } else if ( req.auth.type == 'basic' ) {
      var cr = Buffer.from(req.auth.value,'base64').toString('utf8')
      var usr = cr.split(':',1)[0]
      var pwd = cr.substr(usr.length+1)
      req.user = {
        sub: usr,
        pwd: pwd,
        fiscal_number: usr,
        token: req.auth.value,
        type: req.auth.type
      }
      req.cfg.log(req.user)
    }
  }
}



HttpDispatcher.prototype.log = function(arg) {
  this.cfg.log(arg);
};

HttpDispatcher.prototype.on = function(method, args) {
  if ( typeof this.listeners[method] === 'undefined' )
    this.listeners[method] = [];
  var azione = {
    method: method,
    url: args.shift(),
    actions: [],
  };
  args.forEach(function(entry) {
    azione.actions.push(entry.name);
  });
  this.services.push(azione);

  this.listeners[method].push(this.urlManage({
    url: azione.url,
    cb: args
  }));
};

HttpDispatcher.prototype.onHead = function() {
  const args = Array.from(arguments);
  this.on('head', args);
};

HttpDispatcher.prototype.onGet = function() {
  const args = Array.from(arguments);
  this.on('get', args);
};

HttpDispatcher.prototype.onPost = function() {
  const args = Array.from(arguments);
  this.on('post', args);
};

HttpDispatcher.prototype.onOptions = function() {
  const args = Array.from(arguments);
  this.on('options', args);
};

HttpDispatcher.prototype.onPut = function() {
  const args = Array.from(arguments);
  this.on('put', args);
};

HttpDispatcher.prototype.onDelete = function() {
  const args = Array.from(arguments);
  this.on('delete', args);
};

HttpDispatcher.prototype.onPatch = function() {
  const args = Array.from(arguments);
  this.on('patch', args);
};

HttpDispatcher.prototype.beforeFilter = function() {
  const args = Array.from(arguments);
  args[0] = new RegExp('^'+args[0]);
  this.on('before', args);
};

HttpDispatcher.prototype.afterFilter = function() {
  const args = Array.from(arguments);
  args[0] = new RegExp('^'+args[0]);
  this.on('after', args);
};

HttpDispatcher.prototype.setStatic = function(folder,dirname) {
  this.staticUrlPrefix = folder;
  this.staticDirname = dirname;
  this.onGet(new RegExp('^'+folder),this.staticListener.bind(this));
};

HttpDispatcher.prototype.onError = function(cb) {
  this.errorListener = cb;
};

HttpDispatcher.prototype.onAuth = function(cb) {
  this.auth = cb;
};

HttpDispatcher.prototype.start = function(config) {
  var proto = config.server.protocol == 'http:' ? http : https;
  proto.createServer(config.server.options, function(req,res) {
    // Gestione delle attività
    req.cfg = config;
    req.app = this;
    if ( typeof config.database !== 'undefined' ) req.db = config.database.dbconfig;
    req.reqid = config.uuid();
    config.dispatcher.dispatch(req, res);
  }).listen(config.server.tcp,function(){
    if ( this.listening ) {
      config.log({
        status: "Info",
        name: "lhd listener",
        value: {
          server: config.server,
          services: config.dispatcher.services
        }
      });
    }
  });
};

HttpDispatcher.prototype.dispatch = function(req, res) {
  req.cfg.dispatcher = req.cfg.dispatcher || this;
  req.fullURL = req.url;
  req.StartUpTime = (new Date()).getTime();
  req.params = urlparser.parse(req.url, true).query;

  // Elimina alcune malformazioni nelle url
  for ( i=0; i<this.clean.length; i++ ) {
    req.url = req.url.replace(this.clean[i].e,this.clean[i].r);
  }
  req.staticurl = req.url
  // Elimina contesti non necessari per le api
  for ( var i = 0; i<this.pre.length; i++ ) {
    req.url = req.url.replace(this.pre[i].e,this.pre[i].r);
  }
  // Estrae eventuali parametri di autenticazione JWT o x_rtsysid
  // e li inserisce in req.user
  this.auth(req,res);

  req.chain         = new HttpChain();
  req.cfg.dispatcher.getFilters(req, 'before');
  req.cfg.dispatcher.getListener(req);
  req.cfg.dispatcher.getFilters(req, 'after');

  req.chain.next(req, res);
}

//*
HttpDispatcher.prototype.DataType = function(req,data) {
/*/
HttpDispatcher.prototype.DataType = async function(req,data) {
  const FileType = require('file-type');
  var test = await FileType.fromBuffer(data)
  if ( test ) {
    return test.mime
  }
//*/
  var mime = req.headers['content-type'];
  if ( typeof mime == 'string' )
    mime = mime.split(';')[0]
  if ( mime == 'multipart/form-data')
    return mime
  return mimeType.lookup(mimeType.extension(mime))
}


HttpDispatcher.prototype.getBody =  function(req, res) {
  var chunks = [];
  var dl = 0 ;
  req.on('data', function(data) {
    if ( dl == 0 ) {
      req.bodyType = req.cfg.dispatcher.DataType(req,data);
      req.maxlen =  req.cfg.server.maxlen[req.bodyType] ||
                    req.cfg.server.maxlen['default'];
    }
    dl += data.length;
    if ( dl > req.maxlen ) {
      req.error = {ok:'413', text: 'Payload Too Large', 'Content-Type': req.bodyType};
      req.cfg.dispatcher.response(req.error.ok,JSON.stringify(req.error),req,res);
      req.chain.next(req,res);
    } else {
      chunks.push(data);
    }
  });
  req.on('end', function() {
    req.bodyBuffer = Buffer.concat(chunks);
    req.body = req.bodyBuffer.toString();
    req.bodyData = querystring.parse(req.body);
    req.bodyBufferParts = {}

    if ( req.bodyType === 'multipart/form-data' ) {
      const sep = "--"+(req.headers['content-type'].split(";")[1]).split("=")[1]
      const sepl = sep.length
      const re = {
        enc: 'utf-8',
        nl:       "\r\n",
        name:     new RegExp(' name="([^\"]+)"'),
        filename: new RegExp(' filename="([^\"]+)"'),
        type:     new RegExp('Content-Type: (.+)')
      }
      var buf = req.bodyBuffer
      var fine = buf.indexOf(sep)
      while ( fine != -1 ) {
        var inizio = fine + sepl
        fine = buf.indexOf(sep,inizio)
        if ( fine != -1 ) {
          inizio += re.nl.length
          fine = buf.indexOf(re.nl,inizio)
          var cd = buf.toString(re.enc,inizio,fine)
          var name = cd.match(re.name)[1]
          if ( cd.match(re.filename) ) {
            inizio = fine + re.nl.length
            fine = buf.indexOf(re.nl,inizio)
            cd = buf.toString(re.enc,inizio,fine)
            req.bodyBufferParts.type = cd.match(re.type)[1]
          }
          inizio = fine+2*re.nl.length
          fine = buf.indexOf(sep,inizio)
          req.bodyBufferParts[name] = buf.subarray(inizio,fine-re.nl.length)
        }
      }
    }
    req.chain.next(req,res);
  });
}

HttpDispatcher.prototype.url = urlparser;

HttpDispatcher.prototype.responseJSON = function(status,obj,req,res,ct){
  const rsp = status == 200 ? obj :
    {
      status: status,
      rsp:    obj
    }
  req.cfg.dispatcher.response(status,rsp,req,res)
}

HttpDispatcher.prototype.response = function(status,obj,req,res,ct){
  var rsp = obj
  if ( ! Buffer.isBuffer(obj) ) {
    var rr = typeof obj == 'string' ? obj : JSON.stringify(obj)
    rsp = new Buffer.from(rr)
  }
  var head = req.cfg.server.header
  head['Content-Type'] = ct || 'application/json; charset=utf-8'
  head['Content-Length'] = Buffer.byteLength(rsp, 'utf8')
  head['ETag'] = [req.cfg.name, req.cfg.version, req.reqid].join('/')
  if ( status == 301 || status == 302 )
    head.Location = rsp
  res.writeHead(status, head);
  res.write(rsp, 'utf8');
  res.end()
  res.head = head
  req.cfg.dispatcher.logger(req,res)
  req.chain.next(req,res);
}

HttpDispatcher.prototype.logger = function(req,res){
  req.cfg.log({
    name: req.cfg.name,
    version: req.cfg.version,
    reqid: req.reqid,
    status: res.statusCode,
    method: req.method,
    length: res.head['Content-Length'],
    timems: (new Date()).getTime() - req.StartUpTime,
    url: req.url,
    type: res.head['Content-Type'],
    remoteip: req.socket.remoteAddress,
    user: req.user.sub
  });
}

HttpDispatcher.prototype.redirect = function(status,url,req,res){
  req.cfg.dispatcher.response(status,url,req,res);
}

HttpDispatcher.prototype.request = function(opt,dat,cbr,cbe){
  if ( typeof opt == 'string') opt = urlparser.parse(opt);
  opt.headers = opt.headers || {};
  var datb = '';
  var cb = dat;
  var err = cbr
  if ( typeof dat != 'function' ) {
    cb = cbr;
    err = cbe;
    if ( typeof dat == 'string' ) {
      datb = dat;
    } else {
      if ( opt.headers['Content-Type'] == 'application/x-www-form-urlencoded' ) {
        datb = querystring.stringify(dat);
      } else {
        datb = JSON.stringify(dat);
      }
    }
  }
  opt.headers['Content-Length'] = datb.length;
  const proto = opt.protocol == 'https:' ? https : http ;
  const r = proto.request(opt, (res) => {
    if ( res.statusCode >= 200 && res.statusCode <= 299 ) {
      var data = "";
      res
      .on('data', (d) => {
        data+=d;
      })
      .on('end', () => {
        var d = {}
        try {
          d = JSON.parse(data)
        } catch(e){
          d = data;
        }
        cb(d)
      });
    } else {
      var rsp = {
        status: "Error",
        name: "HttpDispatcher",
        value: {
          statusCode: res.statusCode,
          statusMessage: res.statusMessage,
          action: opt
        }
      };
      this.cfg.log(rsp);
      if ( typeof err == 'function' ) err(rsp);
    }
  }).on('error', (e) => {
    var rsp = {
      status: "Error",
      name: "HttpDispatcher unknown",
      value: {
        action: opt,
        message: e.message
      }
    };
    this.cfg.log(rsp);
    err(rsp);
  });
  if ( datb.length > 0 )
    r.write(datb);
  r.end();
}

HttpDispatcher.prototype.staticListener =  function(req, res) {
  if ( req.method != 'GET' ) {
    req.dispatcher.response(404,"{text: not found}",req,res)
  }
  var url = urlparser.parse(req.url, true);

  var errorListener = this.errorListener;
  var pr = path.relative(this.staticUrlPrefix, url.pathname)
  pr = pr != '' ? pr : "/"
  var filename      = path.join(this.staticDirname,pr)
  if (filename.indexOf(this.staticDirname) !== 0) {
    errorListener(req, res);
    return;
  }
  filename = filename.replace(/\/$/,"/index.html")
  fs.readFile(filename, function(err, file) {
    if(err) {
      req.cfg.dispatcher.redirect(404,'{"text": "not found", "url":"'+req.url+'", "url":"'+req.url+'", "fn": "'+filename+'"}',req,res);
      return;
    }
    const status = 200;
    var head = JSON.parse(JSON.stringify(req.cfg.server.header))
    head['Content-Type'] = mimeType.contentType(path.extname(filename))
    head['Content-Length'] = Buffer.byteLength(file)
    head['ETag'] = [req.cfg.name, req.cfg.version, req.reqid].join('/')
    res.writeHeader(status, head);
    res.write(file, 'binary');
    res.end();
    res.head = head
    req.cfg.dispatcher.logger(req,res)
  });
}

HttpDispatcher.prototype.getListener = function(req, type) {
  const method = typeof type !== 'undefined' ? type : req.method.toLowerCase();
  if (this.listeners[method]) {
    for(var i = 0, listener; i<this.listeners[method].length; i++) {
      listener = this.listeners[method][i];
      var m = this.urlMatches(listener.url, req);
      if( m ) {
        req.urlsec = {};
        m.shift();
        if ( listener.params ) {
          for ( i=0; i<listener.params.length; i++ ) {
            req.urlsec[listener.params[i]] = decodeURI(m[i]);
          }
        } else if ( m.length > 1 ) {
          for(var p in m) {
            if ( m.hasOwnProperty(p) ) {
              req.urlsec[p] = decodeURI(m[p]);
            }
          }
        }
        req.chain.add(listener.cb);
        return;
      }
    }
  } else {
    req.chain.add(req.cfg.dispatcher.errorListener);
  }
};

HttpDispatcher.prototype.getFilters = function(req, type) {
  if (this.listeners[type]) {
    for( var i = 0, filter; i<this.listeners[type].length; i++) {
      filter = this.listeners[type][i];
      if(this.urlMatches(filter.url, req)) req.chain.add(filter.cb);
    }
  }
};

HttpDispatcher.prototype.urlMatches = function(config, req) {
  var url = urlparser.parse(req.url, true).pathname;

  if(config instanceof RegExp) {
    var m = url.match(config);
    return m;
  }
  return config == url;
};

HttpDispatcher.prototype.urlManage = function(listen) {
  // Ricerco costrutti speciali nella url se è una stringa, i termini che
  // iniziano con : e racchiusi fra due / sono letti come parametri
  var url = listen.url;
  var re = new RegExp('/:[^\/]+','gm');
  if ( typeof url == 'string' ) {
    var m = url.match(re);
    if ( m ) {
      for ( var i=0; i<m.length; i++ ) {
        m[i] = m[i].substr(2);
      }
      listen.url = new RegExp( '^' + url.replace(re,'/([^\/]+)') + '$' );
      listen.params = m;
    } else {
      listen.url = new RegExp( '^' + url + '$' );
    }
  }
  return listen;
}

var HttpChain = function() {
  this.queue = [];
};

HttpChain.prototype.add = function(cb) {
  if ( typeof cb == 'function' ) {
    this.queue.push(cb);
  } else if ( [].constructor == cb.constructor) {
    for( var i = 0; i<cb.length; i++ ) {
      this.add(cb[i]);
    }
  }
};

HttpChain.prototype.next = function(req, res) {
  if ( res.finished ) return;
  var cb = this.queue.shift();
  if( cb ) {
    cb(req, res);
  }
};

HttpChain.prototype.stop = function(req, res) {
  res.end();
};

module.exports = HttpDispatcher;
