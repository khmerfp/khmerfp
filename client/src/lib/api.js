
const API_BASE_URL = (
  import.meta.env.VITE_API_URL || "http://localhost:3000"
).replace(/\/+$/, "");

export async function apiRequest(endpoint, options = {}) {
  const response = await fetch(
    `${API_BASE_URL}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`,
    {
      ...options,
      headers: {
        ...options.headers,
        ...(options.body &&
        typeof options.body === "string" &&
        !options.headers?.["Content-Type"]
          ? { "Content-Type": "application/json" }
          : {}),
      },
      credentials: "include",
    }
  );

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(data?.error?.message || data?.message || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.code = data?.error?.code;
    throw error;
  }

  return data;
}

export default API_BASE_URL;
