const headerRgx = /^((?:(?:XLZF|[A-Za-z]+:=.*?)\n)+)/;
const datasizeRgx = /(\nDataSize:=)([0-9]+)\n/;
const savedatasizeRgx = /(\nSaveDataSize:=)([0-9]+)\n/;
var saveEditorElement;
var originalFile;
var saveHeader;

document.getElementById('fileInput').addEventListener('change', function(event) {
  document.getElementById('saveJson').innerHTML = "";
  originalFile = event.target.files[0];
  if (originalFile) {
    const reader = new FileReader();
    reader.onload = function(e) {
      LoadSaveJsonFromCompressedXML(arrayBufferToString(e.target.result));
    };
    reader.readAsArrayBuffer(originalFile);
  }
});

document.getElementById('downloadButton').addEventListener('click', function(e) {
  if (!originalFile) return alert('You must "Find Save" first.')
  DownloadSaveCompressedXML(saveEditorElement.get(), originalFile);
});

function LoadSaveJsonFromCompressedXML(filecontent)
{
  const matched = headerRgx.exec(filecontent);
  if (!matched || !datasizeRgx.exec(matched[0])) return alert('Invalid save file.');
  saveHeader = matched[0];
  const saveData = filecontent.slice(matched[0].length, filecontent.length);
  var parser = new DOMParser();
  var dec = new TextDecoder();
  xmlDoc = parser.parseFromString(dec.decode(decompress(stringToArrayBuffer(saveData))), "text/xml");
  var saveJson = JSON.parse(xml2json(xmlDoc, ""));
  saveEditorElement = new JSONEditor(document.getElementById("saveJson"), {limitDragging: true}, saveJson);
  saveEditorElement.expand({path: ["save"], isExpand: true, recursive: false});
}

function DownloadSaveCompressedXML(saveJson, originalFile)
{
  var saveXml = json2xml(saveJson);
  var enc = new TextEncoder();
  var compressedXml = compress(enc.encode(saveXml));
  saveHeader = saveHeader.replace(datasizeRgx, "\nDataSize:=" + saveXml.length + "\n").replace(savedatasizeRgx, "\nSaveDataSize:=" + compressedXml.byteLength + "\n");
  var zip = new JSZip();
  zip.file(originalFile.name, new Blob([new Blob([saveHeader], { type: 'text/plain' }), new Blob([compressedXml], { type: "application/octet-stream" })]));
  zip.file("Backup of " + originalFile.name, new Blob([originalFile]));
  zip.generateAsync({ type: "blob" }).then(function(content) {
    saveAs(content, originalFile.name + ".zip");
  });
}

function stringToArrayBuffer(binaryString) {
  const length = binaryString.length;
  const buffer = new ArrayBuffer(length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < length; i++) view[i] = binaryString.charCodeAt(i);
  return buffer;
}

function arrayBufferToString(buffer) {
  var string = ""
  var view = new Uint8Array(buffer)
  for (let i = 0; i < buffer.byteLength; i++) string += String.fromCharCode(view[i]);
  return string;
}

function showTab(tabIndex) {
  const tabs = document.querySelectorAll('.tab-content');
  tabs.forEach(tab => tab.classList.remove('active'));
  const selectedTab = document.getElementById('tab-' + tabIndex);
  selectedTab.classList.add('active');
}

new JSONEditor(document.getElementById("dataJson"), {limitDragging: true}, metaData);
showTab(0);
