-- Sulcus Proactive Memory for Neovim
-- Compatible with Avante.nvim, CodeCompanion.nvim, MCPHub.nvim, and native Neovim buffers.

local M = {}

local function load_ini_config()
  local out = {}
  local paths = {
    vim.fn.expand("~/.config/sulcus/sulcus.ini"),
    vim.fn.expand("~/.sulcus/sulcus.ini"),
  }
  for _, p in ipairs(paths) do
    if vim.fn.filereadable(p) == 1 then
      for _, line in ipairs(vim.fn.readfile(p)) do
        local trimmed = vim.trim(line)
        if trimmed ~= "" and not vim.startswith(trimmed, "#") and not vim.startswith(trimmed, ";") and not vim.startswith(trimmed, "[") then
          local eq = string.find(trimmed, "=", 1, true)
          if eq then
            local k = vim.trim(string.sub(trimmed, 1, eq - 1)):lower()
            local v = vim.trim(string.sub(trimmed, eq + 1)):gsub('^["\']', ''):gsub('["\']$', '')
            if (k == "api_key" or k == "server_api_key" or k == "sulcus_api_key") and v ~= "" then
              out.api_key = v
            elseif (k == "server_url" or k == "sulcus_server_url" or k == "remote_url") and v ~= "" then
              out.server_url = v:gsub("/api/v[12]/sync/?$", ""):gsub("/+$", "")
            elseif (k == "namespace" or k == "default_namespace") and v ~= "" then
              out.namespace = v
            end
          end
        end
      end
      break
    end
  end
  return out
end

function M.resolve_config()
  local ini = load_ini_config()
  local cwd = vim.fn.getcwd()
  local slug = vim.fn.fnamemodify(cwd, ":t"):lower():gsub("[^a-z0-9_-]+", "-"):gsub("^-+", ""):gsub("-+$", "")
  return {
    server_url = vim.env.SULCUS_SERVER_URL or ini.server_url or "https://api.sulcus.ca",
    local_url = vim.env.SULCUS_LOCAL_URL or "http://127.0.0.1:4203",
    api_key = vim.env.SULCUS_API_KEY or ini.api_key or "",
    namespace = vim.env.SULCUS_NAMESPACE or (slug ~= "" and slug or ini.namespace or "default"),
    session_id = "neovim-" .. tostring(vim.fn.getpid()),
  }
end

local cached_machine_id = nil
function M.resolve_machine_id()
  if cached_machine_id then
    return cached_machine_id
  end
  if vim.env.SULCUS_MACHINE_ID and vim.trim(vim.env.SULCUS_MACHINE_ID) ~= "" then
    cached_machine_id = vim.trim(vim.env.SULCUS_MACHINE_ID)
    return cached_machine_id
  end
  local id_path = vim.env.SULCUS_MACHINE_ID_PATH
  if not id_path or vim.trim(id_path) == "" then
    id_path = vim.fn.expand("~/.config/sulcus/machine_id")
  end
  if vim.fn.filereadable(id_path) == 1 then
    local lines = vim.fn.readfile(id_path)
    if lines and lines[1] then
      local existing = vim.trim(lines[1])
      if #existing >= 8 and #existing <= 128 and existing:match("^[%w_-]+$") then
        cached_machine_id = existing
        return existing
      end
    end
  end

  local raw_host = "workstation"
  if vim.uv and vim.uv.os_gethostname then
    raw_host = vim.uv.os_gethostname() or "workstation"
  elseif vim.loop and vim.loop.os_gethostname then
    raw_host = vim.loop.os_gethostname() or "workstation"
  end
  local short_host = vim.trim(raw_host):match("^([^.]+)") or "workstation"
  short_host = vim.trim(short_host):lower()
  if short_host == "" then
    short_host = "workstation"
  end
  local clean_user = vim.trim(vim.env.USER or vim.env.USERNAME or "user"):lower()
  if clean_user == "" then
    clean_user = "user"
  end
  local sysname = ""
  if vim.uv and vim.uv.os_uname then
    sysname = (vim.uv.os_uname().sysname or ""):lower()
  elseif vim.loop and vim.loop.os_uname then
    sysname = (vim.loop.os_uname().sysname or ""):lower()
  end
  local canonical_os = "unknown"
  if sysname:find("darwin") or sysname:find("mac") then
    canonical_os = "macos"
  elseif sysname:find("win") then
    canonical_os = "windows"
  elseif sysname:find("linux") then
    canonical_os = "linux"
  elseif sysname ~= "" then
    canonical_os = sysname
  end

  local computed = string.sub(vim.fn.sha256(short_host .. ":" .. clean_user .. ":" .. canonical_os), 1, 32)
  pcall(function()
    local dir = vim.fn.fnamemodify(id_path, ":h")
    vim.fn.mkdir(dir, "p", 448) -- 0700
    vim.fn.writefile({ computed }, id_path)
    vim.fn.setfperm(id_path, "rw-------")
  end)
  cached_machine_id = computed
  return computed
end

local function curl_post_async(url, payload, api_key, on_done)
  local body = vim.fn.json_encode(payload)
  local cmd = {
    "curl", "-sS", "--max-time", "4", "-X", "POST", url,
    "-H", "Content-Type: application/json",
    "-H", "X-Sulcus-Machine-Id: " .. M.resolve_machine_id(),
    "-d", body
  }
  if api_key and api_key ~= "" then
    table.insert(cmd, "-H")
    table.insert(cmd, "Authorization: Bearer " .. api_key)
  end
  vim.fn.jobstart(cmd, {
    stdout_buffered = true,
    on_stdout = function(_, data)
      if on_done and data then
        local raw = table.concat(data, "\n")
        local ok, decoded = pcall(vim.fn.json_decode, raw)
        if ok then
          on_done(decoded)
        end
      end
    end,
  })
end

function M.recall(query, callback)
  local cfg = M.resolve_config()
  local payload = {
    query = query ~= "" and query or "project architecture preferences",
    limit = 8,
    namespace = cfg.namespace,
    session_id = cfg.session_id,
  }
  local target_url = (cfg.api_key ~= "" and cfg.server_url or cfg.local_url) .. "/api/v1/agent/search"
  curl_post_async(target_url, payload, cfg.api_key, function(res)
    local lines = { "# Sulcus Recall (" .. cfg.namespace .. ")" }
    for _, m in ipairs((res and res.results) or {}) do
      local text = m.pointer_summary or m.label or m.content or ""
      text = text:gsub("^[A-Za-z]+:%s*", "")
      table.insert(lines, string.format("- [%s] %s", m.memory_type or "memory", text))
    end
    if callback then
      callback(table.concat(lines, "\n"))
    else
      vim.notify(table.concat(lines, "\n"), vim.log.levels.INFO, { title = "Sulcus Memory" })
    end
  end)
end

function M.ingest(text)
  if not text or #vim.trim(text) < 25 then
    return
  end
  local cfg = M.resolve_config()
  local payload = {
    assistant_output = string.sub(text, 1, 8192),
    namespace = cfg.namespace,
    is_compaction = false,
  }
  curl_post_async(cfg.local_url .. "/api/v1/agent/ingest", payload, "")
  if cfg.api_key ~= "" then
    curl_post_async(cfg.server_url .. "/api/v1/agent/ingest", payload, cfg.api_key)
  end
end

function M.undo(last_n)
  local cfg = M.resolve_config()
  local n = tonumber(last_n) or 1
  local payload = {
    namespace = cfg.namespace,
    session_id = cfg.session_id,
    last_n = n,
  }
  curl_post_async(cfg.local_url .. "/api/v1/agent/ledger/undo", payload, "", function(res)
    if res and res.verified then
      vim.notify("Rewound " .. tostring(n) .. " Activity Ledger turn(s) in " .. cfg.namespace, vim.log.levels.INFO, { title = "Sulcus Undo" })
    end
  end)
  if cfg.api_key ~= "" then
    curl_post_async(cfg.server_url .. "/api/v1/agent/ledger/undo", payload, cfg.api_key)
  end
end

function M.setup(_opts)
  vim.api.nvim_create_user_command("SulcusRecall", function(args)
    M.recall(args.args)
  end, { nargs = "*" })

  vim.api.nvim_create_user_command("SulcusIngest", function(args)
    M.ingest(args.args)
  end, { nargs = "+" })

  vim.api.nvim_create_user_command("SulcusUndo", function(args)
    M.undo(args.args)
  end, { nargs = "?" })
end

return M
