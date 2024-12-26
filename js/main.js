const headerRgx = /^((?:(?:XLZF|[A-Za-z]+:=.*?)\n)+)/;
const datasizeRgx = /(\nDataSize:=)([0-9]+)\n/;
const savedatasizeRgx = /(\nSaveDataSize:=)([0-9]+)\n/;
var saveEditorElement;
var originalFile;
var enc = new TextEncoder();
var dec = new TextDecoder();
var saveHeader;

document.getElementById('fileInput').addEventListener('change', function(event) {
  originalFile = event.target.files[0];
  if (originalFile) {
    const reader = new FileReader();
    reader.onload = function(e) {
      LoadSave(arrayBufferToString(e.target.result));
    };
    reader.readAsArrayBuffer(originalFile);
  }
});

document.getElementById('downloadButton').addEventListener('click', function(e) {
  DownloadSaveCompressedXML(saveEditorElement.get(), originalFile);
});

function LoadSave(filecontent){
  var saveJson = LoadSaveJsonFromCompressedXML(filecontent);
  document.getElementById('fileInput').innerHTML = "";
  saveEditorElement = new JSONEditor(document.getElementById("saveJson"), {}, saveJson);
  saveEditorElement.expand({path: ["save"], isExpand: true, recursive: false});
}

function LoadSaveJsonFromCompressedXML(filecontent)
{
  parser = new DOMParser();
  const matched = headerRgx.exec(filecontent);
  saveHeader = matched[0];
  if (!matched) {
      console.error('No header match found');
      return;
  }
  const datasizeMatch = datasizeRgx.exec(matched[0]);
  if (!datasizeMatch) {
      console.error('No DataSize match found');
      return;
  }
  const saveData = filecontent.slice(matched[0].length, filecontent.length);
  const decoded = decompress(stringToArrayBuffer(saveData));
  xmlDoc = parser.parseFromString(dec.decode(decoded), "text/xml");
  return JSON.parse(xml2json(xmlDoc, ""));
}

function DownloadSaveCompressedXML(saveJson, originalFile)
{
  var saveXml = json2xml(saveEditorElement.get());
  var compressedXml = compress(enc.encode(saveXml));
  saveHeader = saveHeader.replace(datasizeRgx, "\nDataSize:=" + saveXml.length + "\n");
  saveHeader = saveHeader.replace(savedatasizeRgx, "\nSaveDataSize:=" + compressedXml.byteLength + "\n");
  var headerBlob = new Blob([saveHeader], { type: 'text/plain' });
  var binaryBlob = new Blob([compressedXml], { type: "application/octet-stream" });

  var zip = new JSZip();
  zip.file(originalFile.name, new Blob([headerBlob, binaryBlob]));
  zip.file("Backup of " + originalFile.name, new Blob([originalFile]));
  zip.generateAsync({ type: "blob" }).then(function(content) {
    saveAs(content, "save.zip");
  });
}

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