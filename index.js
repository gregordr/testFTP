const webdav = require('webdav-server').v2;
const Writable = require('stream').Writable;
var FormData = require('form-data');
const axios = require("axios");
const { Path } = require('webdav-server/lib/index.v2');

axios.defaults.headers.post["Content-Type"] = "application/x-www-form-urlencoded";
axios.defaults.headers.get["Content-Type"] = "application/x-www-form-urlencoded";

class LocalLockManager {
    locks = [];

    constructor(serializedData) {
        if (serializedData)
            for (const name in serializedData)
                this[name] = serializedData[name];
    }

    getLocks(callback) {
        this.locks = this.locks.filter((lock) => !lock.expired());

        callback(null, this.locks);
    }

    setLock(lock, callback) {
        callback(null);
    }

    removeLock(uuid, callback) {
        for (let index = 0; index < this.locks.length; ++index)
            if (this.locks[index].uuid === uuid) {
                this.locks.splice(index, 1);
                return callback(null, true);
            }

        callback(null, false);
    }

    getLock(uuid, callback) {
        this.locks = this.locks.filter((lock) => !lock.expired());

        for (const lock of this.locks)
            if (lock.uuid === uuid)
                return callback(null, lock);

        callback();
    }

    refresh(uuid, timeout, callback) { }
}

class SavePhotoStream extends Writable {
    constructor(name) {
        super();
        this.name = name
    }

    blobs = []

    _write(chunk, encoding, callback) {
        this.blobs.push(chunk)
        callback(null)
    }


    async _final(cb) {
        let formData = new FormData();
        if (this.blobs.length > 0) {
            formData.append("file", Buffer.concat(this.blobs), { filename: this.name, contentType: "image/jpeg" });
            const formHeaders = formData.getHeaders();
            try {
                const res = await axios.post("http://localhost:4000/media/add", formData, {
                    headers: {
                        ...formHeaders,
                    },
                });
                console.log(res.data.success)
                console.log(res.data.errors)
            } catch (e) {
                console.log(e)
                cb(e)
                return
            }
        }
        cb(null)
    }

}

cachedPhotos = { lastCheck: null, photos: [] }

const getCachedPhotos = async () => {
    if (!cachedPhotos.lastCheck || cachedPhotos.lastCheck < Date.now() - 1000 * 60) {

        cachedPhotos.photos = axios.get("http://localhost:4000/media/all")
        cachedPhotos.lastCheck = Date.now();
    }

    return (await cachedPhotos.photos).data.slice(0);
}

// File system
class UploadFS extends webdav.FileSystem {
    props = new webdav.LocalPropertyManager();
    locks = new LocalLockManager();

    created = {}

    _fastExistCheck = async function (ctx, path, callback) {
        if (path.isRoot() || this.created[path.toString()] || path.toString() === "/all photos")
            return callback(true);

        if (path.rootName() === "all photos") {
            return callback(true)
            const photos = await getCachedPhotos()
            if (photos.find((photo) => photo.name === path.fileName()))
                return callback(true)
        }

        callback(false)
    }

    _create = function (path, ctx, callback) {
        this.created[path.toString()] = true
        console.log("create", path)
        callback(null, null)
    }

    _openWriteStream = function (path, ctx, callback) {
        console.log("write", path)
        callback(null, new SavePhotoStream(path.fileName()))
    }

    _propertyManager = function (path, info, callback) {
        callback(null, this.props);
    }

    _lockManager = function (path, info, callback) {
        callback(null, this.locks);
    }

    _type = function (path, info, callback) {
        callback(null, path.isRoot() || path.toString() === "/all photos" ? webdav.ResourceType.Directory : webdav.ResourceType.File);
    }

    _delete = function (path, ctx, cb) {
        console.log("delete", path)
        this.created = {}
        cb(null)
    }

    _readDir = async function (path, ctx, cb) {
        if (path.isRoot())
            return cb(null, [new Path(["all photos"])])

        if (path.removeFile() === "all photos") {
            let paths = []

            const res = await getCachedPhotos()

            for (const photo of res) {
                paths.push(new Path(photo.name))
            }

            return cb(null, paths)
        }

        cb(null, [])
    }
}

// Server instantiation
const server = new webdav.WebDAVServer({
    port: 1901, // Load the server on the port 2000 (if not specified, default is 1900)
});
server.setFileSystemSync('/', new UploadFS());
//server.startAsync((s) => console.log('Ready on port', s.address().port));

const FtpSrv = require('ftp-srv');
const moment = require('moment');
const fsAsync = require('ftp-srv/src/helpers/fs-async');
const ftpServer = new FtpSrv({anonymous:true});

ftpServer.on('login', (data, resolve, reject) => {
    resolve({fs: new myFS()})
 });

ftpServer.listen()
.then(() => { console.log("listening")});

class myFS {
  constructor(connection, {root, cwd} = {}) {
    this.connection = connection;
  }

  get root() {
    return "/"
  }

  currentDirectory() {
    return "/";
  }

   async get(fileName) {
        return {
            isDirectory: () => true
        }
  }

    async list(path = '.') {
      
    console.log("list", path)
    let fileNames = await getCachedPhotos()
        return fileNames.map((photo) => {
          return {
                name: photo.id,
              isDirectory: () => false,
              mtime: moment.unix(photo.date),
                size: 10000000000
          }
      });
  }

    chdir(path = '.') {
      
    return "/"
  }

  write(fileName, {append = false, start = undefined} = {}) {
    return  new SavePhotoStream(fileName)
    ;
  }

async read(fileName, { start = undefined } = {}) {
    console.log("read", fileName)

    let stream =  await axios({
        method: 'get',
        url: 'http://localhost:4000/media/'+fileName,
        responseType: 'stream'
    });



    return stream.data
  }

  delete(path) {
    const {fsPath} = this._resolvePath(path);
    return fsAsync.stat(fsPath)
    .then((stat) => {
      if (stat.isDirectory()) return fsAsync.rmdir(fsPath);
      else return fsAsync.unlink(fsPath);
    });
  }

  mkdir(path) {
    const {fsPath} = this._resolvePath(path);
    return fsAsync.mkdir(fsPath)
    .then(() => fsPath);
  }

  rename(from, to) {
    const {fsPath: fromPath} = this._resolvePath(from);
    const {fsPath: toPath} = this._resolvePath(to);
    return fsAsync.rename(fromPath, toPath);
  }

  chmod(path, mode) {
    const {fsPath} = this._resolvePath(path);
    return fsAsync.chmod(fsPath, mode);
  }

  getUniqueName() {
    return uuid.v4().replace(/\W/g, '');
  }
}