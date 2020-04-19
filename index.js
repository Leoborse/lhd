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
  };

  this.cfg = configurazione
  this.cfg.header = this.cfg.header || {
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

  var config = cfg.dispatcherConfig;
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
  };

// xxxx autehntication
  this.auth = function(req, res) {
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
//          const header = Buffer.from(jwt.split('.')[0], 'base64').toString('utf8');
          const token = Buffer.from(jwt.split('.')[1], 'base64').toString('utf8')
          req.user = JSON.parse(token)
          req.user.token = req.auth.value
          req.user.type = req.auth.type
        } catch(e) {
        }
      } else if ( req.auth.type == 'basic' ) {
        var cr = Buffer.from(req.auth.value,'base64').toString('utf8')
        var un = cr.split(':',1)[0]
        req.user = {
          sub: un,
          pwd: cr.substr(un.length+1),
          up: cr,
          fiscal_number: un,
          token: req.auth.value,
          type: req.auth.type
        }
      }
    }
  }

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
  };
  for(var p in this.maxlen) {
    if (this.maxlen.hasOwnProperty(p)) {
      if( config && typeof config.maxlen[p] == 'number') {
        this.maxlen[p] = config.maxlen[p];
      }
    }
  }
};

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
  proto.createServer( function(req,res) {
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
      req.maxlen =  req.cfg.dispatcherConfig.maxlen[req.bodyType] ||
                    req.cfg.dispatcherConfig.maxlen['default'];
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

HttpDispatcher.prototype.response = function(status,obj,req,res,ct){
  const rsp = Buffer.isBuffer(obj) || typeof obj == 'string' ? obj : JSON.stringify(obj)
  var head = JSON.parse(JSON.stringify(req.cfg.header))
  head['Content-Type'] = ct || 'application/json; charset=utf-8'
  head['Content-Length'] = rsp.length
  head['ETag'] = [req.cfg.name, req.cfg.version, req.reqid].join('/')
  if ( status == 301 || status == 302 )
    head.Location = rsp
  const t0 = (new Date()).getTime() - req.StartUpTime;
  res.writeHead(status, head);
  res.write(rsp, 'binary');
  res.end();
  const t = (new Date()).getTime() - req.StartUpTime;
  req.cfg.log({
    name: req.cfg.name,
    version: req.cfg.version,
    reqid: req.reqid,
    status: status,
    method: req.method,
    length: head['Content-Length'],
    timems: t,
    timefbms: t0,
    url: req.url,
    type: head['Content-Type'],
    user: req.user.sub
  });
  req.chain.next(req,res);
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
  const t0 = (new Date()).getTime() - req.StartUpTime;
  fs.readFile(filename, function(err, file) {
    if(err) {
      req.cfg.dispatcher.redirect(404,'{"text": "not found", "url":"'+req.url+'", "url":"'+req.url+'", "fn": "'+filename+'"}',req,res);
      return;
    }
    const status = 200;
    var head = JSON.parse(JSON.stringify(req.cfg.header))
    head['Content-Type'] = mimeType.contentType(path.extname(filename))
    head['Content-Length'] = Buffer.byteLength(file)
    head['ETag'] = [req.cfg.name, req.cfg.version, req.reqid].join('/')
    res.writeHeader(status, head);
    res.write(file, 'binary');
    res.end();
    const t = (new Date()).getTime() - req.StartUpTime;
    req.cfg.log({
      name: req.cfg.name,
      version: req.cfg.version,
      reqid: req.reqid,
      status: status,
      method: req.method,
      length: head['Content-Length'],
      timems: t,
      timefbms: t0,
      url: req.url,
      type: head['Content-Type'],
      user: req.user.sub
    });
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
