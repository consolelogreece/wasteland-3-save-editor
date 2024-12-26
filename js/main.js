
const headerRgx = /^((?:(?:XLZF|[A-Za-z]+:=.*?)\n)+)/;
const datasizeRgx = /(\nDataSize:=)([0-9]+)\n/;
const savedatasizeRgx = /(\nSaveDataSize:=)([0-9]+)\n/;
var saveEditorElement;
var saveHeader;
var originalFile;
var originalFileName;
var enc = new TextEncoder();
var dec = new TextDecoder();

document.getElementById('fileInput').addEventListener('change', function(event) {
    const file = event.target.files[0];
    originalFileName = event.target.files[0].name
    if (file) {
      const reader = new FileReader();
      reader.onload = function(e) {
        const fileContent = e.target.result;
        originalFile = fileContent
        go(arrayBufferToString(fileContent));
      };

      reader.readAsArrayBuffer(file)
    }
  });

  document.getElementById('saveButton').addEventListener('click', function(event) {
    saveFile()
  });

function saveFile()
{
  var saveJson = saveEditorElement.get()
  var saveXml = json2xml(saveJson)
  saveHeader = saveHeader.replace(datasizeRgx, "\nDataSize:=" + saveXml.length + "\n")
  var compressedXml = compress(enc.encode(saveXml))
  saveHeader = saveHeader.replace(savedatasizeRgx, "\nSaveDataSize:=" + compressedXml.byteLength + "\n")
  var headerBlob = new Blob([saveHeader], { type: 'text/plain' });
  var binaryBlob = new Blob([compressedXml], { type: "application/octet-stream" })

  var zip = new JSZip();
  
  zip.file(originalFileName, new Blob([headerBlob, binaryBlob]))
  zip.file("backup of " + originalFileName, new Blob([originalFile]))

  zip.generateAsync({ type: "blob" }).then(function(content) {
    saveAs(content, "save.zip");
  });

  //saveAs(new Blob([headerBlob, binaryBlob]), "save.xml");
}

function go(filecontent){
  var saveJson = LoadSaveJson(filecontent)
  document.getElementById('fileInput').innerHTML = ""
  saveEditorElement = new JSONEditor(document.getElementById("saveJson"), {}, saveJson)
}

function LoadSaveJson(filecontent)
{
  tempsave = filecontent
  parser = new DOMParser();
  xmlDoc = parser.parseFromString(loadFile(filecontent), "text/xml");
  return JSON.parse(xml2json(xmlDoc, ""));
}

function loadFile(data) {
  const matched = headerRgx.exec(data);
  saveHeader = matched[0]
  if (!matched) {
      console.error('No header match found');
      return;
  }
  const datasizeMatch = datasizeRgx.exec(matched[0]);
  if (!datasizeMatch) {
      console.error('No DataSize match found');
      return;
  }
  
  const saveData = data.slice(matched[0].length, data.length)
  const decoded = decompress(stringToArrayBuffer(saveData))
  return dec.decode(decoded);
}