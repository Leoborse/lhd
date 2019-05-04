# LHD
(Another) Light HTTP(s) Dispatcher

LHD is a light http(s) dispatcher based on [`HttpDispatcher`](https://github.com/alberto-bottarini/httpdispatcher)

LHD allows developer to have a clear dispatcher for dynamic pages and static resources. Classes http.ServerRequest and http.ServerResponse earns new params property containing a map of received HTTP parameters.

## Prerequisites

nodejs and npm

## Installing

Installing is very easy. Enter into the root directory of your project and npm

```
cd root_directory_where_is_located_your_file_package.json
npm install --save lhd
```

## Usage

### HTTP(S) Client

```js
    const lhd = require('lhd');
    const dis = new lhd(); // No arguments needed
    
    const options = {
      protocol: 'https:',
      host: 'www.servizi.toscana.it',
      port: 443,
      path: '/index.html',
      method: 'POST',
      headers: {
        Content-Type: 'application/json'
      },
      rejectUnauthorized: true
    };
    
    var data = 'Some data to send ...';
    dis.request(options,data,callBack); // data is optional
```

where:

options.protocol defines the protocol to be used, ie. `http:` or `https:`

options is defined in nodejs http(s) class.


### HTTP(S) Server

```js
    const lhd         = require('lhd');
    let cfg = {
      'name': 'MyWebApplication',
      'version': '1.0.0',
      'environment': 'Develope',
      'server': {
        'protocol': 'http:',
        'tcp': {
          'host': '0.0.0.0',
          'port': 9091
        },
        'options': {
        }
      },
      'dispatcherConfig': {
        'maxlen': {
          'application/json': 100e3,
          'default': 0
        }
      }
    };
    const dis = new lhd(cfg);

    // some listeners as example (API)
    // :type means a value that is a parameter with name 'type'
    dis.beforeFilter(jwt, knownUser);
    dis.onGet('/config/:type', isAdmin, .... , okresponse);
    dis.onPost('/config/:type', isAdmin, .... , okresponse);
    dis.onPut('/config/:type', isAdmin, .... , okresponse);
    dis.onDelete('/config/:type', isAdmin, .... , okresponse);

    // Static files are checked if no API is referenced
    // First parameter i the url path the second is the local folder where files are located
    dis.setStatic('/','static');

    // start the server
    dis.start(cfg);
    
    function isAdmin(req,res) {
      if ( ! cfg.managers[req.user.sub] ) {
        req.err = {
          n: 403,
          text: 'Forbidden: Insufficient privileges'
        }
        req.cfg.dispatcher.errorListener(req,res);
      }
      req.chain.next(req,res);
    }
    
    function knownUser(req,res) {
      if ( typeof req.user.sub === 'undefined' ) {
        req.err = {
          n: 401,
          text: 'Unauthorized'
        }
        req.cfg.dispatcher.errorListener(req,res);
      }
      req.chain.next(req,res);
    }
    
    function readBody(req,res) {
      req.cfg.dispatcher.getBody(req,res)
    }
    
    function okresponse(stat,docs,req,res){
      const status = 200;
      const rsp = 'The response data, string, json, ...';
      req.cfg.dispatcher.response(status,rsp,req,res);
    }

```

The methods onGet, onPost, .., in the above example are used to register listeners.
When a request is received the methods are chained and executed in sequence.
Small methods are better verified and tested.
Usually a sequence like the following may be a good choice
- Authenticate
- Autorize
- Check input data
- Do the job
- Filter the response

In the example above cfg is the server configuration, where:
- server.protocol defines the protocol to be used, ie. `http:` or `https:`. In the case o https the server.options MUST contain the server key and certificate according to [`https.createServer`](https://nodejs.org/api/https.html#https_https_createserver_options_requestlistener)
- server.tcp are ip and port 
- server.dispatcherConfig defines the max file length by file content type that the server can receive (in POST or PUT for example). Types not mentioned are treated as default. In the example above json have to be smaller than 100KBytes, any othes file is rejected.
the content type of the file is determined first by the magic bytes, last by content type.

request and response
---------

Every listeners is called with two parameters `request` and `response`.

Request object is an instance of [`http.ClientRequest`](https://nodejs.org/api/http.html#http_class_http_clientrequest) with some custom properties:

The request object extesions are the following:
- req.user: Object content depends on authentication type (Authorization header)
    - Author
- req.params: Object. The properties of this object are those extracted from the request url. In the above example (see :type in the above example)
- req.bodyBuffer : [`Buffer`](https://nodejs.org/api/buffer.html#buffer_class_buffer)
- req.body : String representation of input data (if possible)
- req.bodyData: Object form encoded input data

Response object is an instance of [`http.ServerResponse`](https://nodejs.org/api/http.html#http_class_http_serverresponse).

# Author

LHD is based on [`HttpDispatcher`](https://github.com/alberto-bottarini/httpdispatcher)
* [**Leonardo Borselli**](https://github.com/Leoborse) - *First Release*


# License

This project is licensed under the MIT License - see the [`LICENSE`](LICENSE) file for details