import { FolderTree } from "lucide-react";

export function UploadData() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5x1 mx-auto p-8">
        <div className="lg:grid-col-2 grid grid-cols-1 gap-6">
          {/* left column (input fields) */}
          <div className="space-y-6">
            {/* Data Structure */}
            <div className="rounded-lg border border-gray-200 bg-white p-6">
              <div className="mb-4 flex items-center gap-2">
                <FolderTree className="h-5 w-5 text-gray-700" />
                <h2 className="text-gray-900">Data Structure</h2>
              </div>

              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="experiment"
                    className="mb-1.5 block text-gray-700"
                  >
                    Experiment
                  </label>
                  <input
                    id="experiment"
                    type="text"
                    placeholder="e.g., Experiment1"
                    // value={}
                    // onChange={}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-transparent focus:ring-2 focus:ring-green-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="location"
                    className="mb-1.5 block text-gray-700"
                  >
                    Experiment
                  </label>
                  <input
                    id="location"
                    type="text"
                    placeholder="e.g., Davis"
                    // value={}
                    // onChange={}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-transparent focus:ring-2 focus:ring-green-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="population"
                    className="mb-1.5 block text-gray-700"
                  >
                    Experiment
                  </label>
                  <input
                    id="population"
                    type="text"
                    placeholder="e.g., Cowpea"
                    // value={}
                    // onChange={}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-transparent focus:ring-2 focus:ring-green-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="date" className="mb-1.5 block text-gray-700">
                    Date
                  </label>
                  <input
                    id="date"
                    type="date"
                    // value={}
                    // onChange={}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-transparent focus:ring-2 focus:ring-green-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="Platform"
                    className="mb-1.5 block text-gray-700"
                  >
                    Platform
                  </label>
                  <input
                    id="platform"
                    type="text"
                    placeholder="e.g. DJI Mavic 4"
                    // value={}
                    // onChange={}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-transparent focus:ring-2 focus:ring-green-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="sensor"
                    className="mb-1.5 block text-gray-700"
                  >
                    Sensor
                  </label>
                  <input
                    id="sensor"
                    type="text"
                    placeholder="e.g., Hasselbald"
                    // value={}
                    // onChange={}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-transparent focus:ring-2 focus:ring-green-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
