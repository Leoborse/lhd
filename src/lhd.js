const fs          = require('fs');
const http        = require('http');
const https       = require('https');
const fileType    = require('file-type');   // Magic-bytes
const mimeType    = require('mime-types');
const path        = require('path');
const querystring = require('querystring');
const urlparser   = require('url');

var HttpDispatcher = function(configurazione) {
  configurazione = configurazione || {};
  if ( typeof configurazione.dispatcher == 'undefined' ) configurazione.dispatcher = this;
  if ( typeof configurazione.uuid == 'undefined' ) 
  configurazione.uuid = function() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random()*16|0, v = c == 'x' ? r : (r&0x3|0x8);
      return v.toString(16).toLowerCase(); //Lowercase ITU X.667 §6.5.4
    })
  };

  this.cfg = configurazione;
  cfg = this.cfg;
  if ( typeof cfg.log == 'undefined' ) cfg.log = function(m){
    if ( typeof m.status == 'number' ) {
      console.log(m);
    } else if ( m.status == 'Info' && typeof m.value.server !== 'undefined' ) {
      var s = m.value.server;
      console.log(`Usage: ${s.protocol}\/\/${s.tcp.host}:${s.tcp.port}`);
    } else {
//      console.log(JSON.stringify(m));
    }
  }
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
      environment: cfg.environment||'Developing',
    }
  });

  var config = cfg.dispatcherConfig;
  this.services = [];
  this.listeners = {
  };
  // Pulisce url con errori evidenti // /./ /../
  this.clean     = 
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
  
  this.auth = function(req, res) {
    req.user = {
      sub: "Anonimous"
    };
    if ( ! req.headers ) return;
    if ( req.headers['authorization'] ) {
      const a = req.headers['authorization'].replace(/ +/g," ").split(" ");
      req.auth = {
        type: a[0],
        value: a[1]
      };
      if ( req.auth.type == 'Bearer' ) {
        try {
          const jwt = req.auth.value;
          var token = Buffer.from(jwt.split('.')[1], 'base64').toString('utf8');
          req.user = JSON.parse(token);
          req.user.token = jwt;
        } catch(e) {
        }
      }
    } else if ( req.headers['x_rtsysid'] ) {
      req.user.sub = req.headers['x_rtsysid'];
    }
  };

  // Prefix paths
  this.pre = [];
  if ( config && config.apiPaths && config.apiPaths.length ) {
    for ( var i=0; i<config.apiPaths.length; i++) {
      this.pre.push( {e: new RegExp('^'+config.apiPaths[i]), r:''} );
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

HttpDispatcher.prototype.start = function(cfg) {
  var proto = cfg.server.protocol == 'http:' ? http : https;
  proto.createServer( function(req,res) {
    // Gestione delle attività
    req.cfg = cfg;
    req.app = this;
    if ( typeof cfg.database !== 'undefined' ) req.db = cfg.database.dbconfig;
    req.reqid = cfg.uuid();
    cfg.dispatcher.dispatch(req, res);
  }).listen(cfg.server.tcp,function(){
    if ( this.listening ) {
      cfg.log({
        status: "Info",
        name: "lhd listener",
        value: {
          server: cfg.server,
          services: cfg.dispatcher.services
        }
      });
    }
  });
};

HttpDispatcher.prototype.DataType = function(req,data) {
  var d = data ? data : req.bodyBuffer;
  // Content-Type ottenuto dalla lettura dei magic bytes
  req.bodyType = fileType(d);
  if ( req.bodyType ) return req.bodyType;
  // Content-Type ottenuto dal nome del file o dall'header della richiesta
  var fn = req.urlsec['filename'] || urlparser.parse(req.url).pathname;
  var mm = fn ? mimeType.lookup(fn) : req.headers['content-type'];
  var mime = mm ? mm : mimeType.lookup('a.json');
  req.bodyType = {
    ext: mimeType.extension(mime),
    mime: mime
  }
  return req.bodyType;
}
  
HttpDispatcher.prototype.dispatch = function(req, res) {
  if ( typeof req.cfg.dispatcher === 'undefined' ) req.cfg.dispatcher = this;

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
};

HttpDispatcher.prototype.getBody =  function(req, res) {
  var chunks = [];
  var dl = 0 ;
  req.on('data', function(data) {
    if ( dl == 0 ) {
      var ft = req.cfg.dispatcher.DataType(req,data);
      req.maxlen = req.cfg.dispatcher.maxlen[ft.mime] || req.cfg.dispatcher.maxlen['default'];
    }
    dl += data.length;
    if ( dl > req.maxlen ) {
      req.error = {ok:413, text: 'Payload Too Large', ft: ft};
      req.cfg.dispatcher.errorListener(req,res);
      req.chain.next(req,res);
    } else {
      chunks.push(data);
    }
  });
  req.on('end', function() {
    req.bodyBuffer = Buffer.concat(chunks);
    req.body = req.bodyBuffer.toString();
    req.bodyData = querystring.parse(req.body);
    req.chain.next(req,res);
  });
}

HttpDispatcher.prototype.url = urlparser;

HttpDispatcher.prototype.response = function(status,obj,req,res){
  const rsp = typeof obj == 'string' ? obj : JSON.stringify(obj);
  const l = Buffer.byteLength(rsp);
  let head = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': l,
//    'ETag': [req.cfg.name, req.cfg.version, req.reqid].join('/')
  };
  if ( status == 301 || status == 302 )
    head.Location = rsp
  const t0 = (new Date()).getTime() - req.StartUpTime;
  res.writeHead(status, head);
  res.end(rsp);
  const t = (new Date()).getTime() - req.StartUpTime;
  req.cfg.log({
    name: req.cfg.name,
    version: req.cfg.version,
    reqid: req.reqid,
    status: status,
    method: req.method,
    length: l,
    timems: t,
    timefbms: t0,
    url: req.url,
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
        var datb = querystring.stringify(dat);
      } else {
        var datb = JSON.stringify(dat);
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
        try {
          cb(JSON.parse(data));
        } catch(e){
          cb(data);
        }
      });
    } else {
      var rsp = {
        status: "Error",
        name: "HttpDispatcher",
        value: {
          statusCode: res.statusCode,
          statusMessage: res.statusMessage,
          action: opt,
          response: res
        }
      };
      cfg.log(rsp);
      if ( typeof cbe == 'function' ) cbe(rsp);
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
    cfg.log(rsp);
    if ( typeof cbe == 'function' ) cbe(rsp);
  });
  if ( datb.length > 0 )
    r.write(datb);
  r.end();
}

HttpDispatcher.prototype.staticListener =  function(req, res) {
  var url = urlparser.parse(req.url, true);
  
  var errorListener = this.errorListener;
  var filename      = path.join(this.staticDirname, 
                      path.relative(this.staticUrlPrefix, url.pathname));
  if (filename.indexOf(this.staticDirname) !== 0) {
    errorListener(req, res);
    return;
  }
  const t0 = (new Date()).getTime() - req.StartUpTime;
  fs.readFile(filename, function(err, file) {
    if(err) {
      if ( url.pathname.match(/\.[^\/]*$/) ) {  // Finisce con un nome file
        errorListener(req, res);
        return;
      } else if ( url.pathname.match(/\/$/) ) { // Finisce con /
        req.url += 'index.html'
        req.cfg.dispatcher.staticListener(req,res);
      } else {                                  // Non ha estensione, finisce con nome cartella
        req.url += '/'
        req.cfg.dispatcher.redirect(302,req.url,req,res);
      }
      return;
    }
    var ft = req.cfg.dispatcher.DataType(req,file);
    const status = 200;
    const l = Buffer.byteLength(file);
    res.writeHeader(status, {
      'Content-Length': l,
      'Content-Type': ft.mime
    });
    res.write(file, 'binary');
    res.end();
    const t = (new Date()).getTime() - req.StartUpTime;
    req.cfg.log({
      name: req.cfg.name,
      version: req.cfg.version,
      reqid: req.reqid,
      status: status,
      method: req.method,
      length: l,
      timems: t,
      timefbms: t0,
      url: req.url,
      user: req.user.sub
    });
  });
};

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
