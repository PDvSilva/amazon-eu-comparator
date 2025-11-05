# 🚀 Como Fazer Deploy no Render - Guia Rápido

## Problema: Deploy não está sendo acionado automaticamente

### Solução 1: Ativar Auto-Deploy no Render (Recomendado)

1. **Acesse o Dashboard do Render:**
   - Vá para: https://dashboard.render.com
   - Faça login

2. **Encontre seu serviço:**
   - Procure por `amazon-eu-comparator` na lista de serviços
   - Clique no serviço

3. **Ativar Auto-Deploy:**
   - Vá em **Settings** (Configurações)
   - Role até a seção **"Build & Deploy"**
   - Verifique se **"Auto-Deploy"** está **ativado**
   - Se estiver desativado, **ative** e salve

4. **Forçar Deploy Manual (se necessário):**
   - No topo da página, clique em **"Manual Deploy"**
   - Selecione **"Deploy latest commit"**
   - Aguarde o deploy completar (~2-3 minutos)

---

### Solução 2: Recriar o Serviço usando Blueprint (Se o serviço não existir)

Se o serviço não existe ou você quer recriar usando o `render.yaml`:

1. **No Dashboard do Render:**
   - Clique em **"New +"** → **"Blueprint"**
   - Conecte seu repositório GitHub
   - O Render detectará automaticamente o `render.yaml`
   - Clique em **"Apply"**

2. **Isso criará o serviço com todas as configurações corretas**

---

### Solução 3: Verificar Configurações do Serviço

Se o serviço já existe, verifique:

1. **Branch correto:**
   - Settings → Build & Deploy
   - Branch deve ser: `main`

2. **Build Command:**
   - Deve ser: `npm install`

3. **Start Command:**
   - Deve ser: `npm start`

4. **Variáveis de Ambiente:**
   - `PORT` = `10000`
   - `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD` = `false`

---

### Verificar se o Deploy Funcionou

Após o deploy, teste:

1. **Health Check:**
   ```
   https://seu-app.onrender.com/api/health
   ```
   Deve retornar: `{"status":"ok",...}`

2. **Teste de Comparação:**
   ```
   https://seu-app.onrender.com/compare?q=iphone
   ```

3. **Interface Web:**
   ```
   https://seu-app.onrender.com
   ```

---

### Problemas Comuns

#### ❌ Erro: "Puppeteer failed to launch"
- **Solução:** O código já está configurado corretamente com os argumentos necessários
- Verifique os logs no Render para ver o erro específico

#### ❌ Deploy falha no build
- **Solução:** Verifique os logs de build no Render
- Pode ser problema de memória (plano grátis tem limites)
- Tente aumentar o timeout no Settings

#### ❌ App vai para "sleep"
- **Solução:** Normal no plano grátis após 15min de inatividade
- Primeira requisição após sleep demora ~30s
- Para evitar: upgrade para plano Hobby ou use cron job externo

---

## 📝 Checklist Rápido

- [ ] Código está no repositório (git push feito)
- [ ] Serviço existe no Render
- [ ] Auto-deploy está ativado
- [ ] Branch configurado: `main`
- [ ] Build Command: `npm install`
- [ ] Start Command: `npm start`
- [ ] Variáveis de ambiente configuradas
- [ ] Deploy manual acionado (se auto-deploy não funcionar)

---

**Se ainda não funcionar, verifique os logs no Render Dashboard para ver o erro específico!**

