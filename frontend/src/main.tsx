import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query"
import { createRouter, RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import ReactDOM from "react-dom/client"
import { OpenAPI } from "./client"
import { ThemeProvider } from "./components/theme-provider"
import { Toaster } from "./components/ui/sonner"
import { ProcessProvider } from "./contexts/ProcessContext"
import "./index.css"
import { routeTree } from "./routeTree.gen"

// In production Tauri builds the sidecar injects __GEMI_BACKEND_URL__ before
// the app loads, so we can use whatever free port was chosen at launch.
// In dev mode (and when the env var is set) we fall back to VITE_API_URL.
OpenAPI.BASE =
  (window as any).__GEMI_BACKEND_URL__ ?? import.meta.env.VITE_API_URL ?? ""

const queryClient = new QueryClient()

const router = createRouter({ routeTree })
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <QueryClientProvider client={queryClient}>
        <ProcessProvider>
          <RouterProvider router={router} />
          <Toaster richColors closeButton />
        </ProcessProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
)
