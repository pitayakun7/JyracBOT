const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField } = require('discord.js');
const express = require('express');

// --- 1. Botの初期化 ---
const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] 
});

// --- 2. スリープ対策用サーバー (Render用) ---
const app = express();
app.get('/', (req, res) => res.send('Bot is active!'));
app.listen(3000);

// --- 3. メインイベント処理 ---
client.on('interactionCreate', async interaction => {
    
    // [コマンド処理]
    if (interaction.isChatInputCommand()) {
        const { commandName, options } = interaction;

        // /verify コマンド
        if (commandName === 'verify') {
            const role = options.getRole('role');
            const embed = new EmbedBuilder().setTitle(options.getString('title')).setDescription(options.getString('desc'));
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`v_role_${role.id}`).setLabel('✅認証').setStyle(ButtonStyle.Success)
            );
            await interaction.reply({ embeds: [embed], components: [row] });
        }

        // /role-confirmation コマンド
        if (commandName === 'role-confirmation') {
            const member = options.getMember('target');
            const roles = member.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name).join('\n') || 'なし';
            await interaction.reply({ content: `**${member.user.tag}** の付与ロール:\n\`\`\`\n${roles}\n\`\`\``, ephemeral: true });
        }

        // /ticket コマンド
        if (commandName === 'ticket') {
            const adminRole = options.getRole('admin-role');
            const embed = new EmbedBuilder().setTitle(options.getString('title')).setDescription(options.getString('desc'));
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`ticket_${adminRole.id}`).setLabel(options.getString('btn-name')).setStyle(ButtonStyle.Primary)
            );
            await interaction.reply({ embeds: [embed], components: [row] });
        }
    }

    // [ボタン処理]
    if (interaction.isButton()) {
        // 認証ボタン
        if (interaction.customId.startsWith('v_role_')) {
            const roleId = interaction.customId.split('_')[2];
            await interaction.member.roles.add(roleId);
            await interaction.reply({ content: 'ロールを付与しました！', ephemeral: true });
        }

        // チケット作成ボタン
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

// --- 4. 起動 ---
client.login(process.env.DISCORD_TOKEN);