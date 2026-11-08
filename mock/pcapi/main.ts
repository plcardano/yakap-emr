import { createMockPcapi } from "./server";

const port = Number(process.env.MOCK_PCAPI_PORT ?? 4010);

createMockPcapi()
  .listen(port)
  .then((url) => console.log(`Mock PCAPI listening at ${url}`));
