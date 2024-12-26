function stringToArrayBuffer(binaryString) {
    const length = binaryString.length;
    const buffer = new ArrayBuffer(length);
    const view = new Uint8Array(buffer);
    
    for (let i = 0; i < length; i++) {
        view[i] = binaryString.charCodeAt(i);
    }
    
    return buffer;
  }
  
  function arrayBufferToString(buffer) {
    var string = ""
    var view = new Uint8Array(buffer)
    for (let i = 0; i < buffer.byteLength; i++) {
        string += String.fromCharCode(view[i])
    }
    
    return string;
  }
  
  function xmlToJson(xmlNode) {
    return {
        text: xmlNode.firstChild && xmlNode.firstChild.nodeType === 3 ? 
                  xmlNode.firstChild.textContent : '',
        children: [...xmlNode.children].map(childNode => xmlToJson(childNode))
    };
  }