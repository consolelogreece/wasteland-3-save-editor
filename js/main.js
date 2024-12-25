
const headerRgx = /^((?:(?:XLZF|[A-Za-z]+:=.*?)\n)+)/;
const datasizeRgx = /(\nDataSize:=)([0-9]+)\n/;
const savedatasizeRgx = /(\nSaveDataSize:=)([0-9]+)\n/;
var saveEditorElement
var saveHeader
var tempsave

document.getElementById('fileInput').addEventListener('change', function(event) {
    const file = event.target.files[0]; // Get the first file selected
    if (file) {
      const reader = new FileReader(); // Create a FileReader to read the file
      reader.onload = function(e) {
        const fileContent = e.target.result;
        go(fileContent);
      };
  
      reader.readAsBinaryString(file); // Read the file as text
      //reader.readAsArrayBuffer(file)
    }
  });

  document.getElementById('saveButton').addEventListener('click', function(event) {
    saveFile()
  });

function saveFile()
{
  var saveJson = saveEditorElement.get()
  var saveXml = json2xml(saveJson)
  saveHeader.replace(datasizeRgx, "DataSize:=" + saveXml.length)
  var enc = new TextEncoder()
  var dec = new TextDecoder()
  var compressedXml = dec.decode(compress(enc.encode(saveXml)))
  saveHeader.replace(datasizeRgx, "SaveDataSize:=" + compressedXml.length)
  var final = saveHeader + compressedXml
  console.log(final)

}

function go(filecontent){
  var saveJson = LoadSaveJson(filecontent)
  saveEditorElement = new JSONEditor(document.getElementById("saveJson"), {}, saveJson)
}

function LoadSaveJson(filecontent)
{
  tempsave = filecontent
  parser = new DOMParser();
  xmlDoc = parser.parseFromString(loadFile(filecontent), "text/xml");
  temploadedxml = loadFile(filecontent)
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
  const decoded = decompress(binaryStringToArrayBuffer(saveData))
  const decoder = new TextDecoder('utf-8');
  return decoder.decode(decoded);
}

function binaryStringToArrayBuffer(binaryString) {
  const length = binaryString.length;
  const buffer = new ArrayBuffer(length);
  const view = new Uint8Array(buffer);
  
  for (let i = 0; i < length; i++) {
      view[i] = binaryString.charCodeAt(i);
  }
  
  return buffer;
}

function xmlToJson(xmlNode) {
  return {
      text: xmlNode.firstChild && xmlNode.firstChild.nodeType === 3 ? 
                xmlNode.firstChild.textContent : '',
      children: [...xmlNode.children].map(childNode => xmlToJson(childNode))
  };
}