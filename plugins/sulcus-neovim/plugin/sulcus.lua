if vim.g.loaded_sulcus_nvim == 1 then
  return
end
vim.g.loaded_sulcus_nvim = 1

require("sulcus").setup()
