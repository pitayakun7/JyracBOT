const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField } = require('discord.js');
const express = require('express');

// --- 1. Botの初期化 ---
const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] 
});

// チケットメッセージを保存するメモリ用マップ
const ticketMessages = new Map();

// --- 2. スラッシュコマンド定義 ---
const commands = [
    new SlashCommandBuilder().setName('verify').setDescription('認証パネル')
        .addRoleOption(o => o.setName('role').setDescription('付与するロール').setRequired(true))
        .addStringOption(o => o.setName('title').setDescription('タイトル').setRequired(false))
        .addStringOption(o => o.setName('description').setDescription('説明文').setRequired(false)),
    new SlashCommandBuilder().setName('ticket').setDescription('チケットパネル')
        .addRoleOption(o => o.setName('admin-role').setDescription('管理者ロール').setRequired(true))
        .addStringOption(o => o.setName('title').setDescription('タイトル').setRequired(false))
        .addStringOption(o => o.setName('description').setDescription('説明文').setRequired(false))
        .addStringOption(o => o.setName('panel-desc').setDescription('チケット発行後のメッセージ').setRequired(false)),
    new SlashCommandBuilder().setName('role-confirmation').setDescription('ロール確認')
        .addUserOption(o => o.setName('target').setDescription('対象のメンバー').setRequired(true))
].map(c => c.toJSON());

// --- 3. 起動時にコマンドを自動登録 ---
client.once('clientReady', async () => {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
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
    // [コマンド処理]
    if (interaction.isChatInputCommand()) {
        const { commandName, options } = interaction;

        if (commandName === 'verify') {
            const role = options.getRole('role');
            const title = options.getString('title') ?? 'ロール付与';
            const description = options.getString('description') ?? '認証ボタンを押してロールを取得してください。';
            
            const embed = new EmbedBuilder().setTitle(title).setDescription(description);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`v_role_${role.id}`).setLabel('✅認証').setStyle(ButtonStyle.Success));
            await interaction.reply({ embeds: [embed], components: [row] });
        }

        if (commandName === 'ticket') {
            const adminRole = options.getRole('admin-role');
            const title = options.getString('title') ?? '問い合わせ';
            const description = options.getString('description') ?? 'ボタンを押してチケットを作成してください。';
            const panelDesc = options.getString('panel-desc') ?? 'チケット発行ありがとうございます。担当者が来るまでしばらくお待ちください。';
            
            // メッセージ内容をメモリに保存（キーは現在時刻）
            const messageKey = Date.now().toString();
            ticketMessages.set(messageKey, panelDesc);

            const embed = new EmbedBuilder().setTitle(title).setDescription(description);
            // customIdはIDとキーのみ（制限回避）
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ticket_${adminRole.id}_${messageKey}`).setLabel('チケットを発行').setStyle(ButtonStyle.Primary));
            await interaction.reply({ embeds: [embed], components: [row] });
        }

        if (commandName === 'role-confirmation') {
            const member = options.getMember('target');
            const roles = member.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name).join('\n') || 'なし';
            await interaction.reply({ content: `**${member.user.tag}** の付与ロール:\n\`\`\`\n${roles}\n\`\`\``, ephemeral: true });
        }
    }

    // [ボタン処理]
    if (interaction.isButton()) {
        // ロール付与
        if (interaction.customId.startsWith('v_role_')) {
            const roleId = interaction.customId.split('_')[2];
            await interaction.member.roles.add(roleId);
            await interaction.reply({ content: 'ロールを付与しました！', ephemeral: true });
        }

        // チケット作成
        if (interaction.customId.startsWith('ticket_')) {
            const [_, adminRoleId, messageKey] = interaction.customId.split('_');
            const adminRoleMention = `<@&${adminRoleId}>`;
            const panelDesc = ticketMessages.get(messageKey) ?? 'チケット発行ありがとうございます。';

            const channel = await interaction.guild.channels.create({
                name: `🎫｜${interaction.user.username}`,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                    { id: adminRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                ]
            });

            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('delete_confirm').setLabel('チケット削除').setStyle(ButtonStyle.Danger));
            await channel.send({ content: `${interaction.user} 様\n${panelDesc}\n\n${adminRoleMention}`, components: [row] });
            await interaction.reply({ content: `チケットを作成しました: ${channel}`, ephemeral: true });
        }

        // 削除確認 (二段階)
        if (interaction.customId === 'delete_confirm') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('delete_yes').setLabel('本当に削除する').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('delete_no').setLabel('キャンセル').setStyle(ButtonStyle.Secondary)
            );
            await interaction.reply({ content: '本当にこのチケットを削除しますか？', components: [row], ephemeral: true });
        }

        if (interaction.customId === 'delete_yes') {
            await interaction.channel.delete();
        }
        if (interaction.customId === 'delete_no') {
            await interaction.update({ content: '削除をキャンセルしました。', components: [] });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
