const app = require("./api/server");
const PORT = 8000;

app.listen(PORT, () => {
  console.log(`Server running at  ${PORT}`);
});
