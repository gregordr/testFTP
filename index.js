const webdav = require('webdav-server').v2;
const Writable = require('stream').Writable;
const fs = require("fs")
var FormData = require('form-data');
const axios = require("axios");

axios.defaults.headers.post["Content-Type"] = "application/x-www-form-urlencoded";

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
        fs.appendFileSync(this.name, chunk)
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

// File system
class UploadFS extends webdav.FileSystem {
    props = new webdav.LocalPropertyManager();
    locks = new LocalLockManager();

    created = {}

    _fastExistCheck = function (ctx, path, callback) {
        const res = path.isRoot() || this.created[path.toString()]
        console.log("chech", path, res)
        callback(res);
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
        console.log("Pman", path);
        callback(null, this.props);
    }

    _lockManager = function (path, info, callback) {
        console.log("Lman", path,
            this.locks);
        callback(null, this.locks);
    }

    _type = function (path, info, callback) {
        callback(null, path.isRoot() ? webdav.ResourceType.Directory : webdav.ResourceType.File);
    }

    _delete = function (path, ctx, cb) {
        console.log("delete", path)
        this.created = {}
        cb(null)
    }
}

// Server instantiation
const server = new webdav.WebDAVServer({
    port: 1901, // Load the server on the port 2000 (if not specified, default is 1900)
});
server.setFileSystemSync('/', new UploadFS());
server.start((s) => console.log('Ready on port', s.address().port));

