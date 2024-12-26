var saveEditorElement;
var originalFile;
document.getElementById('fileInput').addEventListener('change', function(event) {
    originalFile = event.target.files[0];
    if (originalFile) {
      const reader = new FileReader();
      reader.onload = function(e) {
        renderSave(arrayBufferToString(e.target.result));
      };

      reader.readAsArrayBuffer(originalFile)
    }
  });

  document.getElementById('saveButton').addEventListener('click', function(event) {
    saveFile(saveEditorElement.get(), originalFile)
  });

function renderSave(filecontent){
  var saveJson = LoadSaveJson(filecontent);
  if (saveJson == null) return;
  document.getElementById('fileInput').innerHTML = ""
  saveEditorElement = new JSONEditor(document.getElementById("saveJson"), {}, saveJson)
  saveEditorElement.expand({path: ["save"], isExpand: true, recursive: false})
}

function LoadSaveJson(filecontent)
{
  parser = new DOMParser();
  var file = loadFile(filecontent)
  if (file == null) return;
  document.getElementById("editorParent").style.display = "block"
  xmlDoc = parser.parseFromString(file, "text/xml");
  return JSON.parse(xml2json(xmlDoc, ""));
}