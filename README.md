# LHD
(Another) Light HTTP(s) Dispatcher

LHD is a light http(s) dispatcher based on [`HttpDispatcher`](https://github.com/alberto-bottarini/httpdispatcher)

LHD allows developer to have a clear dispatcher for dynamic pages and static resources. Classes http.ServerRequest and http.ServerResponse earns new params property containing a map of received HTTP parameters.

## Prerequisites

nodejs and npm

## Installing

Installing is very easy.
enter into the root directory of your project and npm

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

options.protocols defines the protocol to be used.

options is defined in nodejs http(s) class.


### HTTP Server

```js
    const lhd         = require('lhd');
    let cfg = {
      ... JSON.parse( fs.readFileSync( 'conf/config.json') ),
      ... JSON.parse( fs.readFileSync( 'package.json' ) ),
      ... {'ambiente': 'Sviluppo di Leonardo'}
    };
    const dis = new lhd(cfg);
```

request and response
---------

Every listeners is called with two parameters `request` and `response`.

Request object is an instance of [`http.ClientRequest`](https://nodejs.org/api/http.html#http_class_http_clientrequest) with some custom properties:

# To Do
- bodyBuffer : [`Buffer`](https://nodejs.org/api/buffer.html#buffer_class_buffer) (available only on POST request)
- body : String (available only on POST request)
- params : Object

Response object is an instance of [`http.ServerResponse`](https://nodejs.org/api/http.html#http_class_http_serverresponse).


# Author

LHD is based on [`HttpDispatcher`](https://github.com/alberto-bottarini/httpdispatcher)
* **Leonardo Borselli** - *First Release* - [Leoborse](https://github.com/Leoborse)


# License

This project is licensed under the MIT License - see the [`LICENSE`](LICENSE) file for details