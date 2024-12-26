const headerRgx = /^((?:(?:XLZF|[A-Za-z]+:=.*?)\n)+)/;
const datasizeRgx = /(\nDataSize:=)([0-9]+)\n/;
const savedatasizeRgx = /(\nSaveDataSize:=)([0-9]+)\n/;
var enc = new TextEncoder();
var dec = new TextDecoder();
var saveHeader;

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

function saveFile(saveJson, originalFile)
{
  var saveJson = saveEditorElement.get()
  var saveXml = json2xml(saveJson)
  var compressedXml = compress(enc.encode(saveXml))
  saveHeader = saveHeader.replace(datasizeRgx, "\nDataSize:=" + saveXml.length + "\n")
  saveHeader = saveHeader.replace(savedatasizeRgx, "\nSaveDataSize:=" + compressedXml.byteLength + "\n")
  var headerBlob = new Blob([saveHeader], { type: 'text/plain' });
  var binaryBlob = new Blob([compressedXml], { type: "application/octet-stream" })

  var zip = new JSZip();
  zip.file(originalFile.name, new Blob([headerBlob, binaryBlob]))
  zip.file("Backup - " + originalFile.name, new Blob([originalFile]))
  zip.generateAsync({ type: "blob" }).then(function(content) {
    saveAs(content, "save.zip");
  });
}

function loadFile(data) {
  const matched = headerRgx.exec(data);
  saveHeader = matched[0]
  if (!matched) {
      console.error('No header match found');
      return null;
  }
  const datasizeMatch = datasizeRgx.exec(matched[0]);
  if (!datasizeMatch) {
      console.error('No DataSize match found');
      return null;
  }
  
  const saveData = data.slice(matched[0].length, data.length)
  try {
    const decoded = decompress(stringToArrayBuffer(saveData))
    return dec.decode(decoded);
  } catch {
    return null;
  }  
}