'use strict'
function HlsjsIPFSLoaderFactory (ipfs) {
  return class HlsjsIPFSLoader {
    constructor(config) {
      this._abortFlag = [false];
      this.ipfs = ipfs;
      this.hash = config.ipfsHash;
      this.debug = config.debug === false ? function () {
      } : config.debug === true ? console.log : config.debug;
      this.m3u8provider = config.m3u8provider ? config.m3u8provider : null;
      this.tsListProvider = config.tsListProvider ? config.tsListProvider : null;
    }

    destroy() {
    }

    abort() {
      this._abortFlag[0] = true;
    }

    load(context, config, callbacks) {
      this.context = context
      this.config = config
      this.callbacks = callbacks
      this.stats = {trequest: performance.now(), retry: 0}
      this.retryDelay = config.retryDelay
      this.loadInternal()
    }

    /**
     * Call this by getting the HLSIPFSLoader instance from hls.js hls.coreComponents[0].loaders.manifest.setM3U8Provider()
     * @param {function} provider
     */
    setM3U8Provider(provider) {
      this.m3u8provider = provider;
    }

    /**
     *
     * @param {function} provider
     */
    setTsListProvider(provider) {
      this.tsListProvider = provider;
    }

    loadInternal() {
      const {stats, context, callbacks} = this

      stats.tfirst = Math.max(performance.now(), stats.trequest)
      stats.loaded = 0

      //When using absolute path (https://example.com/index.html) vs https://example.com/
      const urlParts = window.location.href.split("/")
      if (urlParts[urlParts.length - 1] !== "") {
        urlParts[urlParts.length - 1] = ""
      }
      const filename = context.url.replace(urlParts.join("/"), "")

      const options = {}
      if (Number.isFinite(context.rangeStart)) {
        options.offset = context.rangeStart;
        if (Number.isFinite(context.rangeEnd)) {
          options.length = context.rangeEnd - context.rangeStart;
        }
      }

      if (filename.split(".")[1] === "m3u8" && this.m3u8provider !== null) {
        const res = this.m3u8provider();
        let data;
        if (Buffer.isBuffer(res)) {
          data = buf2str(res)
        } else {
          data = res;
        }
        const response = {url: context.url, data: data}
        callbacks.onSuccess(response, stats, context)
        return;
      }
      if (filename.split(".")[1] === "m3u8" && this.tsListProvider !== null) {
        var tslist = this.tsListProvider();
        var hash = tslist[filename];
        if (hash) {
          this.cat(hash).then(res => {
            let data;
            if (Buffer.isBuffer(res)) {
              data = buf2str(res)
            } else {
              data = res;
            }
            stats.loaded = stats.total = data.length
            stats.tload = Math.max(stats.tfirst, performance.now())
            const response = {url: context.url, data: data}
            callbacks.onSuccess(response, stats, context)
          });
        }
        return;
      }
      this._abortFlag[0] = false;
      getFile(this.ipfs, this.hash, filename, options, this.debug, this._abortFlag).then(res => {
        const data = (context.responseType === 'arraybuffer') ? res : buf2str(res)
        stats.loaded = stats.total = data.length
        stats.tload = Math.max(stats.tfirst, performance.now())
        const response = {url: context.url, data: data}
        callbacks.onSuccess(response, stats, context)
      }, console.error)
    }
  }
}

async function getFile(ipfs, rootHash, filename, options, debug, abortFlag) {
  // Handle external URLs outside of IPFS
  if (filename.match(/^https?:\/\//)) {
    debug(`External URL detected, falling back to fetch(${filename})`)
    const response = await fetch(filename)
    if (!response.ok) {
      throw new Error('Failed to fetch external URL: ' + path + ', response.status: ' + response.status);
    } else {
      return await response.arrayBuffer();
    }
  }

  debug(`Fetching hash for '${ rootHash ? `${ rootHash }/` : ""}${ filename }'`);
  const path = `${ rootHash ? `${ rootHash }/` : "" }${ filename }`;
  try {
    return await cat(path, options, ipfs, debug, abortFlag)
  } catch(ex) {
    throw new Error(`File not found: ${ rootHash ? `${ rootHash }/` : "" }${filename}`)
  }
}

function buf2str(buf) {
  // .decode() returns a string
  return new TextDecoder().decode(buf)
}

async function cat (cid, options, ipfs, debug, abortFlag) {
  const parts = []
  let length = 0, offset = 0

  // By default, js-ipfs will wait forever
  options.timeout = 20000

  debug('Begin: ipfs.cat(), will invoke ipfs.cat with cid: ' + cid + ', options: ' + options)
  for await (const buf of ipfs.cat(cid, options)) {
    debug('ipfs.cat() returned buf of length: ' + buf.length)
    parts.push(buf)
    length += buf.length
    if (abortFlag[0]) {
      debug('Cancel reading from ipfs')
      break
    }
  }

  const value = new Uint8Array(length)
  for (const buf of parts) {
    value.set(buf, offset)
    offset += buf.length
  }

  debug(`Received data for file '${cid}' size: ${value.length} in ${parts.length} blocks`)
  return value
}

exports = module.exports = HlsjsIPFSLoaderFactory;
