const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField } = require('discord.js');
const express = require('express');

// --- 1. Botの初期化 ---
const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] 
});

// --- 2. スラッシュコマンド定義を一か所に集約 ---
const commands = [
    new SlashCommandBuilder()
        .setName('verify')
        .setDescription('認証パネルを作成します')
        .addRoleOption(o => o.setName('role').setDescription('付与するロール').setRequired(true))
        .addStringOption(o => o.setName('title').setDescription('タイトル').setRequired(true))
        .addStringOption(o => o.setName('desc').setDescription('説明文').setRequired(true)),
    new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('チケットパネルを作成します')
        .addRoleOption(o => o.setName('admin-role').setDescription('管理者ロール').setRequired(true))
        .addStringOption(o => o.setName('title').setDescription('タイトル').setRequired(true))
        .addStringOption(o => o.setName('desc').setDescription('説明文').setRequired(true))
        .addStringOption(o => o.setName('btn-name').setDescription('ボタンの表示名').setRequired(true)),
    new SlashCommandBuilder()
        .setName('role-confirmation')
        .setDescription('メンバーのロールを確認します')
        .addUserOption(o => o.setName('target').setDescription('対象のメンバー').setRequired(true))
].map(command => command.toJSON());

// --- 3. 起動時にコマンドを自動登録 ---
client.once('ready', async () => {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        console.log('Discord APIへコマンドを登録中...');
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('コマンド登録完了！');
    } catch (error) {
        console.error('コマンド登録エラー:', error);
    }
});

// --- 4. Webサーバー (Render維持用) ---
const app = express();
app.get('/', (req, res) => res.send('Bot is active!'));
app.listen(3000);

// --- 5. メイン処理 ---
client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const { commandName, options } = interaction;

        if (commandName === 'verify') {
            const role = options.getRole('role');
            const embed = new EmbedBuilder().setTitle(options.getString('title')).setDescription(options.getString('desc'));
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`v_role_${role.id}`).setLabel('✅認証').setStyle(ButtonStyle.Success)
            );
            await interaction.reply({ embeds: [embed], components: [row] });
        }

        if (commandName === 'ticket') {
            const adminRole = options.getRole('admin-role');
            const embed = new EmbedBuilder().setTitle(options.getString('title')).setDescription(options.getString('desc'));
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`ticket_${adminRole.id}`).setLabel(options.getString('btn-name')).setStyle(ButtonStyle.Primary)
            );
            await interaction.reply({ embeds: [embed], components: [row] });
        }

        if (commandName === 'role-confirmation') {
            const member = options.getMember('target');
            const roles = member.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name).join('\n') || 'なし';
            await interaction.reply({ content: `**${member.user.tag}** の付与ロール:\n\`\`\`\n${roles}\n\`\`\``, ephemeral: true });
        }
    }

    if (interaction.isButton()) {
        if (interaction.customId.startsWith('v_role_')) {
            const roleId = interaction.customId.split('_')[2];
            await interaction.member.roles.add(roleId);
            await interaction.reply({ content: 'ロールを付与しました！', ephemeral: true });
        }
        if (interaction.customId.startsWith('ticket_')) {
            const adminRoleId = interaction.customId.split('_')[1];
            const channel = await interaction.guild.channels.create({
                name: `🎫｜${interaction.user.username}`,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                    { id: adminRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                ]
            });
            await interaction.reply({ content: `チケットを作成しました: ${channel}`, ephemeral: true });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
