/*
  QueueListener(options, callback):
    options:
      mongoConnection:
      collectionName:
      handler(err, msg):
      selector:
      <event>:
      <sort>:
      <closedHandler(err, listener)>:
      <passive>:
      <autoStart>:
  QueueListener.start(callback):
  QueueListener.stop(callback):
  QueueListener.next(data, closeCursor):
*/

var UUID = require('node-uuid');

var errors = {
      E_CONNCLOSED: 'No active server connection!',
      E_NODB: 'No database name provided!',
      E_INVALIDFILTER: 'Invalid or no filter provided!',
      E_NOCALLBACK: 'No callback provided, callback is required!',
      E_INVALIDINDEX: 'Invalid or no index provided!',
      E_INVALIDHANDLER: 'Must provide a valid function as handler!',
      E_MISSINGCONSTRUCTOROPTIONS: 'Must provide options to constructor!',
      E_INVALIDCONSTRUCTOROPTIONS: 'Constructor options must contain db, collectionName, handler, and selector!',
      E_NOTACTIVE: 'Listener is not active!'
    };

var passiveNext = function(err, msg){
  var self = this;
  var next = function(){
    self.next.apply(self, arguments);
  };
  var data = (msg&&msg.length>0)?msg[0]:msg;
  if(data) data = data.data;
  self.handler(err, data, next);
};

var activeNext = function(err, msg){
  var self = this;
  var record = (msg&&msg.length>0)?msg[0]:msg;
  var conversationId = msg.conversationId||false;
  var next = function(){
    if(conversationId){
      var args = Array.prototype.slice.apply(arguments), l = args.length, done = false, data;
//console.log('next: ', conversationId, args);
/*
  next(data, done);
  next(data);
  next(done);
  next();
*/
      switch(args.length){
        case 0:
          done = true;
          break;
        case 1:
          if(typeof(args[0])==='boolean'){
            done = args[0];
          }else{
            done = false;
            data = args[0];
          }
          break;
        default:
          data = args[0];
          done = !!args[1];
          break;
      }
      
      var msgPkt = {
            event: conversationId,
            partial: !done,
            data: data,
            handled: false,
            emitted: new Date(),
          };
      
      self.mongoConnection.insert(self.options.collectionName, msgPkt, function(){});
      self.next.call(self, done);
    }else{
      self.next.apply(self, arguments);
    }
  };
  self.mongoConnection.findAndModify(self.options.collectionName, record, {emitted: -1}, {$set: {handled: true}}, {},
    function(err, data){
      if(!data) next();
      else self.handler(err, data.data, next);
    });
};

var QueueListener = exports.QueueListener = function(options, callback){
  var self = this, nextHandler;
  if(typeof(options)!=='object'){
    throw errors.E_MISSINGCONSTRUCTOROPTIONS;
  }
  if(!(options.mongoConnection&&options.collectionName&&options.handler&&(typeof(options.selector)==='object'))){
    throw errors.E_INVALIDCONSTRUCTOROPTIONS;
  }
  self.options = options;
  self.__defineGetter__('active', function(){
    return (this.options.mongoConnection.active)&&(!!this.cursor);
  });
  self.__defineGetter__('nextHandler', function(){
    return nextHandler;
  });
  self.__defineGetter__('event', function(){
    return options.event;
  });
  self.__defineGetter__('handler', function(){
    return options.handler;
  });
  self.__defineGetter__('mongoConnection', function(){
    return options.mongoConnection;
  });
  if(options.passive){
    nextHandler = passiveNext;
  }else{
    nextHandler = activeNext;
  }
  if(options.autoStart&&options.mongoConnection.db&&options.mongoConnection.db.openCalled){
    self.start(callback);
  }else if(typeof(callback)==='function'){
    callback(null, self);
  }
};

QueueListener.prototype.start = function(callback){
  var self = this;
  if(self.active){
    if(typeof(callback)=='function'){
      callback(null, self);
    }
  }else{
    self.mongoConnection.tailedCursor(self.options.collectionName, self.options.selector, {$natural: 1}, function(err, cursor){
      self.cursor = cursor;
      self.next();
      if(typeof(callback)=='function'){
        callback(null, self);
      }
    });
  }
};

QueueListener.prototype.stop = function(callback){
  var self = this;
  if(self.cursor){
    self.cursor.close();
    if(typeof(self.options.closedHandler)==='function'){
      self.options.closedHandler(null, self);
    }
    self.cursor = false;
  }
  if(typeof(callback)==='function') callback(null, self);
};

QueueListener.prototype.next = function(closeCursor){
  var self = this;
  if(closeCursor||(!self.active)){
    self.stop();
  }else{
    self.cursor.nextObject(function(err, msg){
        if(msg){
          self.nextHandler.apply(self, arguments);
        }else{
          process.nextTick(function(){
            self.next();
          });
        }
      });
  }
};