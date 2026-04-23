const { 
    Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, 
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ChannelType, PermissionsBitField, StringSelectMenuBuilder, 
    StringSelectMenuOptionBuilder, ActivityType 
} = require('discord.js');
const express = require('express');

// --- 1. Botの初期化 ---
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ] 
});

// チケット内容の一時保存用メモリ
const ticketMessages = new Map();

// 【設定】ステータスの自己紹介ループ
const activities = [
    "JYRAC公式Instaはこちら！▶https://www.instagram.com/jyrac_official/",
    "NSF公式Instaはこちら！▶https://www.instagram.com/2024nsfproject/",
    "ボットに関するお知らせはDiscordID’pitayakun7’まで"
];
const intervalSeconds = 15;

// --- 2. スラッシュコマンド定義 ---
const commands = [
    new SlashCommandBuilder().setName('verify').setDescription('認証パネルを作成します')
        .addRoleOption(o => o.setName('role').setDescription('付与するロール').setRequired(true))
        .addStringOption(o => o.setName('title').setDescription('タイトル').setRequired(false))
        .addStringOption(o => o.setName('description').setDescription('説明文').setRequired(false))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles),
    
    new SlashCommandBuilder().setName('ticket').setDescription('チケットパネルを作成します')
        .addRoleOption(o => o.setName('admin-role').setDescription('管理者ロール').setRequired(true))
        .addStringOption(o => o.setName('title').setDescription('タイトル').setRequired(false))
        .addStringOption(o => o.setName('description').setDescription('説明文').setRequired(false))
        .addStringOption(o => o.setName('panel-desc').setDescription('チケット発行後のメッセージ').setRequired(false))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels),
    
    new SlashCommandBuilder().setName('role-confirmation').setDescription('メンバーの付与ロールを確認します')
        .addUserOption(o => o.setName('target').setDescription('対象のメンバー').setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers),
    
    new SlashCommandBuilder().setName('delete').setDescription('メッセージを指定数削除します（二段階確認）')
        .addIntegerOption(o => o.setName('amount').setDescription('削除する数 (1-100)').setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages),
    
    new SlashCommandBuilder().setName('help').setDescription('コマンドの詳細パネルを表示します')
].map(c => c.toJSON());

// --- 3. 起動時処理 & ステータス更新 ---
client.once('ready', async () => {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Bot Ready! コマンド登録完了');
    } catch (error) {
        console.error(error);
    }

    // 自己紹介ステータスのループ
    let i = 0;
    setInterval(() => {
        client.user.setActivity(activities[i], { type: ActivityType.Custom });
        i = (i + 1) % activities.length;
    }, intervalSeconds * 1000);
});

// Render維持用Webサーバー
const app = express();
app.get('/', (req, res) => res.send('Bot is running!'));
app.listen(3000);

// --- 4. メインインタラクション処理 ---
client.on('interactionCreate', async interaction => {
    if (interaction.replied || interaction.deferred) return;

    // --- スラッシュコマンド応答 ---
    if (interaction.isChatInputCommand()) {
        const { commandName, options } = interaction;

        if (commandName === 'help') {
            const embed = new EmbedBuilder()
                .setTitle('📜 コマンドヘルプ')
                .setDescription('詳細を確認したいコマンドを選択してください。')
                .setColor(0x00AE86);
            const select = new StringSelectMenuBuilder().setCustomId('help_select').setPlaceholder('選択してください')
                .addOptions(
                    { label: '/verify', value: 'help_verify' },
                    { label: '/ticket', value: 'help_ticket' },
                    { label: '/role-confirmation', value: 'help_role' },
                    { label: '/delete', value: 'help_delete' }
                );
            await interaction.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
        }

        if (commandName === 'delete') {
            const amount = options.getInteger('amount');
            if (amount < 1 || amount > 100) return await interaction.reply({ content: '1〜100で指定してください。', ephemeral: true });

            const messages = await interaction.channel.messages.fetch({ limit: 1 });
            const lastMsg = messages.first();
            
            let msgDetails = "メッセージが見つかりません";
            if (lastMsg) {
                const link = `https://discord.com/channels/${interaction.guildId}/${interaction.channelId}/${lastMsg.id}`;
                msgDetails = `**発言者:** ${lastMsg.author.tag}\n**内容:** ${lastMsg.content.substring(0, 50) || "（メディア等）"}\n**リンク:** [メッセージへ移動](${link})`;
            }

            const embed = new EmbedBuilder()
                .setTitle('⚠️ 削除の最終確認')
                .setDescription(`本当に **${amount}件** 削除しますか？\n\n**削除対象の先頭:**\n${msgDetails}`)
                .setColor(0xFF0000);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`bulk_delete_yes_${amount}`).setLabel('削除を実行').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('bulk_delete_no').setLabel('キャンセル').setStyle(ButtonStyle.Secondary)
            );
            await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
        }

        if (commandName === 'verify') {
            const role = options.getRole('role');
            const embed = new EmbedBuilder()
                .setTitle(options.getString('title') ?? 'ロール付与')
                .setDescription(options.getString('description') ?? 'ボタンを押してロールを取得。');
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`v_role_${role.id}`).setLabel('✅認証').setStyle(ButtonStyle.Success));
            await interaction.reply({ embeds: [embed], components: [row] });
        }

        if (commandName === 'ticket') {
            const adminRole = options.getRole('admin-role');
            const messageKey = `msg_${Date.now()}`;
            ticketMessages.set(messageKey, options.getString('panel-desc') ?? 'チケット発行ありがとうございます。');
            const embed = new EmbedBuilder()
                .setTitle(options.getString('title') ?? '問い合わせ')
                .setDescription(options.getString('description') ?? 'ボタンでチケットを作成。');
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`tkt_${adminRole.id}_${messageKey}`).setLabel('チケット発行').setStyle(ButtonStyle.Primary));
            await interaction.reply({ embeds: [embed], components: [row] });
        }

        if (commandName === 'role-confirmation') {
            const target = options.getUser('target');
            const member = await interaction.guild.members.fetch(target.id).catch(() => null);
            if (!member) return await interaction.reply({ content: '取得失敗', ephemeral: true });
            const roles = member.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name).join('\n') || 'なし';
            await interaction.reply({ content: `**${member.user.tag}** のロール:\n\`\`\`\n${roles}\n\`\`\``, ephemeral: true });
        }
    }

    // --- セレクトメニュー応答 ---
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'help_select') {
            const helpTexts = {
                help_verify: "# /verify\nロール付与パネル作成。",
                help_ticket: "# /ticket\nチケットパネル作成。",
                help_role: "# /role-confirmation\nロール確認コマンド。",
                help_delete: "# /delete\nメッセージ削除（確認・リンク付き）。"
            };
            await interaction.update({ content: helpTexts[interaction.values[0]], embeds: [], components: [interaction.message.components[0]] });
        }
    }

    // --- ボタン応答 ---
    if (interaction.isButton()) {
        // メッセージ一括削除
        if (interaction.customId.startsWith('bulk_delete_yes_')) {
            const amount = parseInt(interaction.customId.split('_')[3]);
            await interaction.channel.bulkDelete(amount, true).catch(console.error);
            await interaction.update({ content: `✅ ${amount}件削除しました。`, embeds: [], components: [] });
        }
        if (interaction.customId === 'bulk_delete_no') await interaction.update({ content: 'キャンセルしました。', embeds: [], components: [] });

        // ロール付与
        if (interaction.customId.startsWith('v_role_')) {
            const roleId = interaction.customId.split('_')[2];
            await interaction.member.roles.add(roleId).catch(console.error);
            await interaction.reply({ content: '付与完了！', ephemeral: true });
        }

        // チケット発行
        if (interaction.customId.startsWith('tkt_')) {
            const [_, adminRoleId, messageKey] = interaction.customId.split('_');
            const panelDesc = ticketMessages.get(messageKey) ?? 'お待ちください。';
            const channel = await interaction.guild.channels.create({
                name: `🎫｜${interaction.user.username}`,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                    { id: adminRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                ]
            });
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('delete_confirm').setLabel('削除').setStyle(ButtonStyle.Danger));
            await channel.send({ content: `${interaction.user} 様\n${panelDesc}\n\n<@&${adminRoleId}>`, components: [row] });
            await interaction.reply({ content: `チケット作成: ${channel}`, ephemeral: true });
        }

        // チケット個別削除
        if (interaction.customId === 'delete_confirm') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('delete_yes').setLabel('削除実行').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('delete_no').setLabel('キャンセル').setStyle(ButtonStyle.Secondary)
            );
            await interaction.reply({ content: '削除しますか？', components: [row], ephemeral: true });
        }
        if (interaction.customId === 'delete_yes') await interaction.channel.delete().catch(console.error);
        if (interaction.customId === 'delete_no') await interaction.update({ content: 'キャンセル。', components: [] });
    }
});

client.login(process.env.DISCORD_TOKEN);
